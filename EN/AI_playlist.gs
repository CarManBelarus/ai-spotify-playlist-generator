/**
 * @OnlyCurrentDoc
 * Main file for working with the Gemini AI to create Spotify playlists.
 * This script analyzes your library, gets AI recommendations, and generates custom cover art.
 *
 * Version: 2.0 (Independent of library modifications, improved search accuracy)
 */

// ===============================================================
//                           CONFIGURATION
// ===============================================================

const AI_CONFIG = {
  // === REQUIRED SETTINGS ===

  // The ID of the Spotify playlist that will be updated.
  // HOW TO GET IT: Go to your playlist on Spotify, click "...", go to "Share", 
  // and "Copy link to playlist". The ID is the string of characters after "playlist/".
  // Example: '78uFpogH6uDyrEbFxzfp2L'
  SPOTIFY_PLAYLIST_ID: 'YOUR_SPOTIFY_PLAYLIST_ID_HERE', // <<<=== PASTE YOUR PLAYLIST ID HERE

  // === AI & PLAYLIST SETTINGS ===

  // The Gemini model to use for generating track recommendations.
  // 'gemini-2.5-pro' is powerful; 'gemini-2.5-flash' is faster.
  GEMINI_MODEL: 'gemini-2.5-pro',

  // The number of random tracks from your library to be analyzed by the AI.
  // A larger sample gives the AI a better understanding of your taste. 700 is a good balance.
  TRACK_SAMPLE_SIZE_FOR_AI: 700,

  // The maximum size of the final playlist.
  // If the playlist grows larger, the oldest tracks will be removed.
  MAX_PLAYLIST_SIZE: 500,

  // The template for the playlist name. {date} will be replaced with the current date.
  PLAYLIST_NAME_TEMPLATE: 'AI Playlist from {date}',

  // === PLAYLIST CLEANUP SETTINGS (for the optional cleanUpPlaylist function) ===

  // The period (in days) for which listened tracks will be removed from the playlist.
  // e.g., 30 means any track you listened to in the last 30 days will be removed.
  CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS: 30,
};

// ===============================================================
//                MAIN PLAYLIST GENERATION FUNCTION
// ===============================================================

/**
 * The main function to generate and update a Spotify playlist using Gemini AI.
 * This is the function you should run or schedule.
 */
function generateAndCreateSpotifyPlaylist() {
  try {
    Logger.log('Starting the AI playlist creation process...');
    const geminiApiKey = getGeminiApiKey_();

    const randomTracksJsonString = prepareTracksForPrompt_();

    Logger.log('Creating the prompt text for Gemini AI...');
    const promptText = createTrackRecommendationPrompt_(randomTracksJsonString);

    Logger.log(`Calling the ${AI_CONFIG.GEMINI_MODEL} model...`);
    const aiResponseJsonString = callGeminiApi_(geminiApiKey, AI_CONFIG.GEMINI_MODEL, promptText);
    if (!aiResponseJsonString) {
      throw new Error('Received an empty or invalid response from the Gemini API.');
    }

    Logger.log('Parsing the JSON response from the AI...');
    const tracksToSearch = parseAiResponse_(aiResponseJsonString);
    Logger.log(`AI recommended ${tracksToSearch.length} tracks to search for.`);

    if (tracksToSearch.length === 0) {
      Logger.log('AI returned no tracks to search for. Stopping execution.');
      return;
    }

    // <<< --- NEW NORMALIZATION STEP --- >>>
    Logger.log('Normalizing queries before sending to Spotify...');
    const normalizedTracksToSearch = tracksToSearch.map(track => normalizeTrackQuery_(track));

    Logger.log(`Searching for ${normalizedTracksToSearch.length} tracks on Spotify...`);
    let foundSpotifyTracks = Search.multisearchTracks(normalizedTracksToSearch);
    Logger.log(`Found ${foundSpotifyTracks.length} tracks on Spotify.`);

    if (foundSpotifyTracks.length === 0) {
      Logger.log('No tracks were found on Spotify based on the AI recommendations. Stopping execution.');
      return;
    }

    updatePlaylistIncrementally_(foundSpotifyTracks);

    Logger.log('Playlist creation/update process completed successfully.');

  } catch (error) {
    Logger.log(`CRITICAL ERROR: ${error.toString()}`);
    Logger.log(`Stack Trace: ${error.stack}`);
  }
}

// ===============================================================
//                PLAYLIST UPDATE AND COVER ART
// ===============================================================

/**
 * Incrementally updates the playlist: adds new tracks, trims old ones, and sets a new cover.
 * @param {Array<Object>} foundSpotifyTracks An array of tracks recommended by the AI.
 */
function updatePlaylistIncrementally_(foundSpotifyTracks) {
  Logger.log(`Getting existing tracks from playlist ID: ${AI_CONFIG.SPOTIFY_PLAYLIST_ID}...`);
  const existingPlaylistTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  
  let newUniqueTracks = Selector.sliceCopy(foundSpotifyTracks);
  Filter.removeTracks(newUniqueTracks, existingPlaylistTracks);
  Logger.log(`Found ${newUniqueTracks.length} new, unique tracks to add.`);

  if (newUniqueTracks.length === 0) {
    Logger.log('No new tracks to add. The playlist remains unchanged.');
    return;
  }

  let finalTrackList = [];
  Combiner.push(finalTrackList, newUniqueTracks, existingPlaylistTracks);
  Logger.log(`Total tracks after combining: ${finalTrackList.length}.`);

  if (finalTrackList.length > AI_CONFIG.MAX_PLAYLIST_SIZE) {
    const tracksToRemoveCount = finalTrackList.length - AI_CONFIG.MAX_PLAYLIST_SIZE;
    Logger.log(`Playlist exceeds the limit of ${AI_CONFIG.MAX_PLAYLIST_SIZE}. Removing ${tracksToRemoveCount} oldest tracks...`);
    finalTrackList.length = AI_CONFIG.MAX_PLAYLIST_SIZE;
  }

  Logger.log('Attempting to generate and process a new cover art...');
  let coverImageBase64 = null;
  let tempFile = null;

  try {
    const originalImageBase64 = generatePlaylistCover_(finalTrackList);
    if (originalImageBase64) {
      const imageBlob = Utilities.newBlob(Utilities.base64Decode(originalImageBase64), 'image/jpeg', 'temp_cover.jpg');
      tempFile = DriveApp.createFile(imageBlob);
      tempFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      const imageUrlForResize = `https://drive.google.com/uc?id=${tempFile.getId()}`;
      
      Logger.log(`Attempting to resize the image via weserv.nl...`);
      const resizeServiceUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrlForResize)}&w=600&h=600&q=90&output=jpg`;
      const resizedResponse = UrlFetchApp.fetch(resizeServiceUrl, { 'muteHttpExceptions': true });
      
      if (resizedResponse.getResponseCode() === 200) {
        coverImageBase64 = Utilities.base64Encode(resizedResponse.getBlob().getBytes());
        Logger.log(`✅ Image successfully resized.`);
      } else {
        Logger.log(`⚠️ Image resizing service failed (Code: ${resizedResponse.getResponseCode()}). Skipping cover art update.`);
      }
    }
  } catch (e) {
    Logger.log(`⚠️ An error occurred during cover art processing: ${e}.`);
  } finally {
    if (tempFile) {
      try { tempFile.setTrashed(true); Logger.log('Temporary cover art file deleted.'); }
      catch (e) { Logger.log(`Failed to delete temporary file: ${e}`); }
    }
  }

  const playlistName = AI_CONFIG.PLAYLIST_NAME_TEMPLATE.replace('{date}', new Date().toLocaleDateString('en-US'));
  const formattedDateTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM dd, yyyy, HH:mm');

  const playlistData = {
    id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
    name: playlistName,
    tracks: finalTrackList,
    description: `Last updated: ${formattedDateTime}. Added: ${newUniqueTracks.length} new. Total: ${finalTrackList.length}.`,
    coverImage: coverImageBase64
  };

  Logger.log(`Saving ${finalTrackList.length} tracks ${coverImageBase64 ? 'and new cover' : ''} to playlist "${playlistName}"...`);
  savePlaylistWithBase64Cover_(playlistData);
}

// ===============================================================
//                     AI PROMPT CREATION
// ===============================================================

function prepareTracksForPrompt_() {
  Logger.log('Parsing SavedTracks.json using Goofy Cache and sampling tracks...');
  const allTracks = Cache.read('SavedTracks.json');
  if (!allTracks || allTracks.length === 0) {
    throw new Error('Could not read tracks from SavedTracks.json. Ensure Goofy is set up and has run at least once.');
  }
  Logger.log(`Successfully read ${allTracks.length} tracks.`);
  const randomTracks = Selector.sliceRandom(allTracks, AI_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
  Logger.log(`Selected ${randomTracks.length} random tracks for analysis.`);
  return JSON.stringify(randomTracks);
}

function createTrackRecommendationPrompt_(tracksJsonString) {
  const today = new Date();
  const formattedDate = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  return `
[Role]: You are a music curator and researcher specializing in finding unexpected connections between different music scenes, genres, and eras.

[Context]: I am providing you with a random sample of tracks from my music library. Your goal is to analyze my tastes and create a precise playlist for discovering new music.

[Temporal Context]: Today's date is ${formattedDate}. Use this to infer the current season and mood (e.g., late summer, autumn melancholy) and let it subtly influence your recommendations.

[Input Data]: A list of tracks in JSON format.
\`\`\`json
${tracksJsonString}
\`\`\`

[Task]:
1. Analyze the input data to identify the main genres, moods, eras, and characteristic features of my musical taste.
2. Based on this analysis and the temporal context, generate a list of 200 music tracks for discovering new music.

[Constraints and Rules]:
- **No Duplicates:** DO NOT include tracks that are already in the input data.
- **Prioritize Novelty:** Try to suggest artists that are not in the original list.
- **Diversity:**
    - ~70% of the recommendations should closely match the identified tastes.
    - ~30% should be a bold "step aside": experiment with less obvious adjacent genres, different eras, or geographies.
- **Local Scene:** About 30% of the artists in the final list should be from Belarus.
- **Language Filter:** Avoid songs in Russian.

[Output Format]:
- The response must be EXCLUSIVELY a valid JSON array.
- Each element of the array is a string in the format "Artist Name - Track Title".
- Do not add any explanations, comments, or markdown (like \`\`\` or *) before or after the JSON block.
- **VERY IMPORTANT FOR SEARCH ACCURACY:**
- **Clean Strings:** All titles must be in lower case.
- **No Special Characters:** Remove all non-alphanumeric characters like ()[]{}'’"“” etc., except for hyphens within names.
- **No Metadata:** Do not add words like 'remastered', 'live version', 'radio edit', etc. to the track title.

[Example of perfect output]:
[
  "the cure - a forest",
  "joy division - disorder",
  "molchat doma - sudno borys ryzhyi",
  "lavon volski - pavietrany shar"
]
`;
}

// ===============================================================
//                     COVER ART GENERATION
// ===============================================================

function generatePlaylistCover_(tracks) {
  try {
    const imagePrompt = createImagePromptFromTracks_(tracks);
    if (!imagePrompt) {
      Logger.log('Failed to create an image prompt.');
      return null;
    }
    Logger.log(`Generated image prompt: "${imagePrompt}"`);
    return callGeminiImageGenerationApi_(imagePrompt);
  } catch (error) {
    Logger.log(`Error during cover art generation: ${error}`);
    return null;
  }
}

function createImagePromptFromTracks_(tracks) {
  const trackSample = Selector.sliceRandom(tracks, 50); 
  const trackListString = trackSample.map(t => `${t.artists[0].name} - ${t.name}`).join('\n');

  const promptForPrompt = `
[Role]: You are a professional art director and expert in creating effective prompts for AI image generators.
[Context]: I am giving you a list of music tracks. Analyze their combined mood and aesthetic to create a SINGLE, highly detailed, technically precise prompt for an AI to generate a square album cover.
[Input Data]:
${trackListString}
[Rules for the output prompt]:
- **Technical Quality:** Include keywords for high-quality images: "hyperrealistic", "8k resolution", "intricate details", "professional photography".
- **Style:** Suggest a specific, evocative visual style: "cinematic still", "lomography photo", "double exposure", "retro-futurism", "surrealism".
- **Lighting & Composition:** Describe lighting in detail: "cinematic lighting", "volumetric light", "moody lighting", "hard shadows".
- **Atmosphere:** Focus on abstract emotions and textures, not literal scenes.
- **Brevity:** The final prompt must be a single, concise paragraph under 120 words.
- **Language:** The prompt MUST be in English.
[Output Format]: ONLY the text of the prompt itself. No explanations, titles, or quotation marks.
[Example of a perfect output]:
Cinematic wide-angle shot of a lone, glowing figure in a rain-slicked, neon-lit alleyway. Moody, atmospheric lighting with long shadows and volumetric fog. Shot on a 35mm lens, shallow depth of field, Portra 400 film grain. Hyperrealistic, intricate details on the wet pavement. An atmosphere of melancholic solitude and urban decay.
`;

  try {
    const geminiApiKey = getGeminiApiKey_();
    const imagePromptText = callGeminiApi_(geminiApiKey, 'gemini-2.5-flash', promptForPrompt); 
    return imagePromptText ? imagePromptText.replace(/`/g, '') : null;
  } catch (e) {
    Logger.log(`Failed to create the image prompt: ${e}`);
    return null;
  }
}

// ===============================================================
//                       HELPER FUNCTIONS
// ===============================================================

/**
 * [NEW - INDEPENDENT] Saves the playlist using standard Goofy functions and then
 * uploads the Base64 cover image separately. This avoids modifying the library.
 * @param {object} data - Playlist data object (id, name, tracks, description, coverImage).
 */
function savePlaylistWithBase64Cover_(data) {
  Logger.log('Executing standard save for tracks and metadata...');
  Playlist.saveWithReplace({
    id: data.id,
    name: data.name,
    description: data.description,
    tracks: data.tracks
  });

  if (data.coverImage) {
    Logger.log('Base64 cover image found. Attempting to upload...');
    try {
      SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${data.id}/images`, data.coverImage);
      Logger.log('✅ Cover art successfully uploaded.');
    } catch (e) {
      Logger.log(`⚠️ Error during cover art upload: ${e.toString()}`);
    }
  }
}

/**
 * [NEW - NORMALIZER] Normalizes a track query string from the AI for maximum search accuracy.
 * Includes transliteration from Cyrillic to Latin.
 * @param {string} rawQuery - The raw string from the AI.
 * @return {string} A cleaned and transliterated string ready for searching.
 */
function normalizeTrackQuery_(rawQuery) {
  if (typeof rawQuery !== 'string' || rawQuery.length === 0) return "";
  
  const TRANSLIT_TABLE = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z',
    'и':'i','й':'i','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p',
    'р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch',
    'ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'iu','я':'ia',
    'і':'i','ў':'u','ґ':'g','є':'ie','ї':'i'
  };

  let cleanedQuery = rawQuery.toLowerCase();
  cleanedQuery = cleanedQuery.split('').map(char => TRANSLIT_TABLE[char] || char).join('');
  cleanedQuery = cleanedQuery.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').trim();
  const noiseWords = ['remastered', 'remaster', 'live', 'radio edit', 'album version', 'single version', 'bonus track'];
  noiseWords.forEach(word => {
    cleanedQuery = cleanedQuery.replace(new RegExp(`\\b${word}\\b`, 'gi'), '');
  });
  cleanedQuery = cleanedQuery.replace(/^the\s+/, '');
  cleanedQuery = cleanedQuery.replace(/[^a-z0-9\s]/g, ' ').replace(/\s{2,}/g, ' ').trim();

  return cleanedQuery;
}

/**
 * [IMPROVED] Parses the raw string response from Gemini, cleaning up common formatting errors.
 * @param {string} rawResponse - The raw string from the AI.
 * @return {Array<string>} An array of tracks to search for.
 */
function parseAiResponse_(rawResponse) {
  let cleanedJsonString = rawResponse;
  cleanedJsonString = cleanedJsonString.replace(/^\s*[\*\-]\s*/gm, '');
  cleanedJsonString = cleanedJsonString.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  cleanedJsonString = cleanedJsonString.replace(/,\s*\]/g, ']');

  try {
    let tracks = JSON.parse(cleanedJsonString);
    if (!Array.isArray(tracks)) {
      throw new Error("AI response is not an array after cleanup.");
    }
    const validTracks = tracks.filter(item => typeof item === 'string' && item.trim().length > 0);
    if (validTracks.length !== tracks.length) {
      Logger.log(`Warning: ${tracks.length - validTracks.length} invalid or empty items were removed from AI response.`);
    }
    return validTracks;
  } catch (e) {
    Logger.log(`CRITICAL parsing error: ${e.message}`);
    Logger.log(`Raw response was: \n---\n${rawResponse}\n---`);
    Logger.log(`Cleaned string was: \n---\n${cleanedJsonString}\n---`);
    return [];
  }
}

function getGeminiApiKey_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error("API Key 'GEMINI_API_KEY' not found in Script Properties.");
  }
  return apiKey;
}

function callGeminiApi_(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const requestPayload = {
     "contents": [{"parts": [{"text": prompt}]}],
     "generationConfig": {
       "temperature": 1.2,
       "responseMimeType": "application/json",
       "responseSchema": {"type": "array", "items": { "type": "string" }}
     },
     "safetySettings": [
        { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
      ]
   };
  const options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(requestPayload), 'muteHttpExceptions': true };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();
    if (responseCode === 200) {
      const jsonResponse = JSON.parse(responseBody);
      if (jsonResponse.candidates && jsonResponse.candidates[0]?.content?.parts[0]?.text) {
         return jsonResponse.candidates[0].content.parts[0].text;
      } else {
         Logger.log(`API returned 200 but response structure was unexpected. Body: ${responseBody}`);
         return null;
      }
    } else {
      Logger.log(`Error calling Gemini API. Code: ${responseCode}. Body: ${responseBody}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Exception during Gemini API call: ${error}`);
    return null;
  }
}

function callGeminiImageGenerationApi_(imagePrompt) {
  const apiKey = getGeminiApiKey_();
  const model = 'gemini-2.0-flash-preview-image-generation';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;
  const requestPayload = {
    "contents": [{"parts": [{ "text": `Generate a single, high-quality, photorealistic square album cover based strictly on the following creative description: ${imagePrompt}` }]}],
    "generationConfig": { "responseModalities": ["IMAGE", "TEXT"] }
  };
  const options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(requestPayload), 'muteHttpExceptions': true };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();
    if (responseCode === 200) {
      const chunks = JSON.parse(responseBody);
      for (const chunk of chunks) {
        if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
          Logger.log('✅ Image data found in the API response.');
          return chunk.candidates[0].content.parts[0].inlineData.data;
        }
      }
      Logger.log(`API returned 200 but no image data was found. Response: ${responseBody}`);
      return null;
    } else {
      Logger.log(`Error calling Image API. Code: ${responseCode}. Response: ${responseBody}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Exception during Image API call: ${error}`);
    return null;
  }
}

// ===============================================================
//                  OPTIONAL CLEANUP FUNCTION
// ===============================================================

/**
 * This function can be run on a schedule (e.g., hourly) to remove tracks from the
 * target playlist that you have recently listened to.
 */
function cleanUpPlaylist() {
  const playlistIdToClean = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
  Logger.log(`Cleanup Task: Starting for playlist ID: ${playlistIdToClean}`);

  try {
    let currentPlaylistTracks = Source.getPlaylistTracks('', playlistIdToClean);
    if (!currentPlaylistTracks || currentPlaylistTracks.length === 0) {
      Logger.log(`Cleanup Task: Playlist is empty. Finishing.`);
      return;
    }
    const initialTrackCount = currentPlaylistTracks.length;

    Logger.log(`Cleanup Task: Getting listening history for the last ${AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS} days...`);
    let recentTracksHistory = RecentTracks.get();
    Filter.rangeDateRel(recentTracksHistory, AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS, 0);
    
    Filter.removeTracks(currentPlaylistTracks, recentTracksHistory);
    const finalTrackCount = currentPlaylistTracks.length;

    if (finalTrackCount < initialTrackCount) {
      Logger.log(`Cleanup Task: ${initialTrackCount - finalTrackCount} tracks will be removed. Updating playlist...`);
      Playlist.saveWithReplace({ id: playlistIdToClean, tracks: currentPlaylistTracks });
      Logger.log(`Cleanup Task: Playlist was successfully updated.`);
    } else {
      Logger.log(`Cleanup Task: No listened tracks found in the playlist. No changes made.`);
    }
  } catch (error) {
    Logger.log(`Cleanup Task ERROR: ${error}`);
  }
}
