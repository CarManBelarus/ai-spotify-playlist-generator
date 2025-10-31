/**
 * @OnlyCurrentDoc
 * Main file for working with the Gemini AI to create Spotify playlists.
 * This script analyzes your library, gets AI recommendations, and generates custom cover art.
 *
 * Version: 3.0 (Reliable incremental updates, Hugging Face covers, enhanced cleanup)
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
  // 'gemini-1.5-pro-latest' is powerful; 'gemini-1.5-flash-latest' is faster.
  GEMINI_MODEL: 'gemini-1.5-pro-latest',

  // The number of random tracks from your library to be analyzed by the AI.
  // A larger sample gives the AI a better understanding of your taste. 700 is a good balance.
  TRACK_SAMPLE_SIZE_FOR_AI: 700,

  // The maximum size of the final playlist.
  // If the playlist grows larger, the oldest tracks will be removed.
  MAX_PLAYLIST_SIZE: 500,

  // The template for the playlist name. {date} will be replaced with the current date.
  PLAYLIST_NAME_TEMPLATE: 'AI Playlist from {date}',

  // === COVER ART GENERATION SETTINGS (VIA HUGGING FACE) ===

  IMAGE_GENERATION: {
    // Enable or disable cover art generation (true/false)
    ENABLED: true,
    
    // Select the model for generation. Just copy the ID from one of the options below.
    // Recommendation: JUGGERNAUT_XL or PHOTO_REALISTIC produce excellent results.
    SELECTED_MODEL_ID: 'RunDiffusion/Juggernaut-XL-v9',

    // Available models (you can add your own found on Hugging Face)
    AVAILABLE_MODELS: {
      // --- RECOMMENDATIONS ---
      JUGGERNAUT_XL: 'RunDiffusion/Juggernaut-XL-v9', // Very popular model for cinematic photorealism.
      SD_3_MEDIUM: 'stabilityai/stable-diffusion-3-medium-diffusers', // Stable Diffusion 3: latest, very accurate model.
      PHOTO_REALISTIC: 'playgroundai/playground-v2.5-1024px-aesthetic', // Excellent aesthetic model.
      FLUX: 'black-forest-labs/FLUX.1-schnell', // Very fast and high-quality model.

      // --- OTHER STYLES ---
      ARTISTIC: 'openskyml/dreamshaper-xl-1-0', // Best for an artistic, "painted" style.
      ANIME: 'cagliostrolab/animagine-xl-3.0', // Best for anime style.
      TURBO: 'stabilityai/sdxl-turbo', // Very fast SDXL version for testing.
      DEFAULT_SDXL: 'stabilityai/stable-diffusion-xl-base-1.0' // Standard Stable Diffusion XL.
    }
  },

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

    Logger.log('Normalizing queries before sending to Spotify...');
    const normalizedTracksToSearch = tracksToSearch.map(track => normalizeTrackQuery_(track));

    Logger.log(`Searching for ${normalizedTracksToSearch.length} tracks on Spotify...`);
    let foundSpotifyTracks = Search.multisearchTracks(normalizedTracksToSearch);
    Logger.log(`Found ${foundSpotifyTracks.length} tracks on Spotify.`);

    if (foundSpotifyTracks.length === 0) {
      Logger.log('No tracks were found on Spotify based on the AI recommendations. Stopping execution.');
      return;
    }

    updatePlaylistAndCover_(foundSpotifyTracks);

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
 * [NEW VERSION] Comprehensively updates the playlist: adds new tracks in chunks,
 * trims old ones to the limit, and updates metadata (name, description, cover).
 * @param {Array<Object>} foundSpotifyTracks An array of tracks recommended by the AI.
 */
function updatePlaylistAndCover_(foundSpotifyTracks) {
  Logger.log(`Getting existing tracks from playlist ID: ${AI_CONFIG.SPOTIFY_PLAYLIST_ID}...`);
  const existingPlaylistTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  
  let newUniqueTracks = Selector.sliceCopy(foundSpotifyTracks);
  Filter.removeTracks(newUniqueTracks, existingPlaylistTracks);
  const newTracksCount = newUniqueTracks.length;
  Logger.log(`Found ${newTracksCount} new, unique tracks to add.`);

  // --- STEP 1: Add new tracks (if any) ---
  if (newTracksCount > 0) {
    Logger.log(`Starting chunked addition of ${newTracksCount} tracks...`);
    const CHUNK_SIZE = 100; // Spotify API limit
    for (let i = 0; i < newTracksCount; i += CHUNK_SIZE) {
      const chunk = newUniqueTracks.slice(i, i + CHUNK_SIZE);
      Logger.log(`Adding chunk of ${chunk.length} tracks...`);
      try {
        Playlist.saveWithAppend({
          id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
          tracks: chunk,
          position: 'begin' // Add new tracks to the beginning
        });
        if (newTracksCount > CHUNK_SIZE) Utilities.sleep(1000); // Pause between requests
      } catch (e) {
        Logger.log(`ERROR during track chunk addition: ${e.toString()}`);
      }
    }
    Logger.log('Chunked track addition completed.');
  }

  // --- STEP 2: Trim the playlist to the size limit (if needed) ---
  const currentTracksAfterAdd = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  if (currentTracksAfterAdd.length > AI_CONFIG.MAX_PLAYLIST_SIZE) {
    const tracksToRemoveCount = currentTracksAfterAdd.length - AI_CONFIG.MAX_PLAYLIST_SIZE;
    Logger.log(`Playlist exceeds the limit (${AI_CONFIG.MAX_PLAYLIST_SIZE}). Removing ${tracksToRemoveCount} oldest tracks...`);
    const trimmedTracks = currentTracksAfterAdd.slice(0, AI_CONFIG.MAX_PLAYLIST_SIZE);
    Playlist.saveWithReplace({
      id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
      tracks: trimmedTracks
    });
    Logger.log('Playlist successfully trimmed.');
  }

  // --- STEP 3: Update name, description, and cover art ---
  const finalTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  
  const playlistName = AI_CONFIG.PLAYLIST_NAME_TEMPLATE.replace('{date}', new Date().toLocaleDateString('en-US'));
  const formattedDateTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM dd, yyyy, HH:mm');

  const payload = {
    name: playlistName,
    description: `Last updated: ${formattedDateTime}. Added: ${newTracksCount} new. Total: ${finalTracks.length}.`
  };

  Logger.log(`Updating playlist name and description...`);
  try {
    SpotifyRequest.put(`${API_BASE_URL}/playlists/${AI_CONFIG.SPOTIFY_PLAYLIST_ID}`, payload);
    Logger.log('✅ Name and description successfully updated.');
  } catch (e) {
    Logger.log(`⚠️ Error during playlist details update: ${e.toString()}`);
  }

  Logger.log('Attempting to generate and upload new cover art...');
  const coverImageBase64 = generatePlaylistCover_(finalTracks);
  if (coverImageBase64) {
    try {
      SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${AI_CONFIG.SPOTIFY_PLAYLIST_ID}/images`, coverImageBase64);
      Logger.log('✅ Cover art successfully uploaded.');
    } catch (e) {
      Logger.log(`⚠️ Error during cover art upload: ${e.toString()}`);
    }
  }
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
- **Genre Classics:** Be sure to include ~5 iconic hits from the dominant genre identified in the input data.
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

/**
 * Main function for generating the playlist cover art.
 * @param {Array<Object>} tracksForAnalysis An array of tracks to analyze for mood.
 * @return {string | null} A Base64 encoded image or null.
 */
function generatePlaylistCover_(tracksForAnalysis) {
  if (!AI_CONFIG.IMAGE_GENERATION.ENABLED) {
    Logger.log('Cover art generation is disabled in settings.');
    return null;
  }

  if (!tracksForAnalysis || tracksForAnalysis.length === 0) {
    Logger.log('Playlist is empty, skipping cover art generation.');
    return null;
  }

  try {
    const imagePrompt = createImagePromptFromTracks_(tracksForAnalysis);
    if (!imagePrompt) {
      Logger.log('Failed to create an image prompt.');
      return null;
    }
    
    const originalImageBase64 = callHuggingFaceApi_(imagePrompt);
    if (!originalImageBase64) return null;
    
    // Attempt to resize the image for faster loading on Spotify
    return resizeImage_(originalImageBase64);
    
  } catch (error) {
    Logger.log(`⚠️ An error occurred during cover art generation: ${error.toString()}`);
    return null;
  }
}

/**
 * Creates a text prompt for an image generator based on a list of tracks.
 * @param {Array<Object>} tracks An array of tracks to analyze.
 * @return {string | null} The generated prompt or null.
 */
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
    // Use a fast model to generate the prompt
    const imagePromptText = callGeminiApi_(geminiApiKey, 'gemini-1.5-flash-latest', promptForPrompt); 
    return imagePromptText ? imagePromptText.replace(/[`"']/g, '') : null;
  } catch (e) {
    Logger.log(`Failed to create the image prompt: ${e}`);
    return null;
  }
}

/**
 * Resizes an image using the external weserv.nl service.
 * @param {string} originalBase64 The Base64 encoded image.
 * @return {string} The resized Base64 image, or the original on failure.
 */
function resizeImage_(originalBase64) {
  let tempFile = null;
  try {
    const imageBlob = Utilities.newBlob(Utilities.base64Decode(originalBase64), 'image/jpeg', 'temp_cover.jpg');
    tempFile = DriveApp.createFile(imageBlob);
    tempFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const imageUrlForResize = `https://drive.google.com/uc?id=${tempFile.getId()}`;
      
    Logger.log(`Attempting to resize the image via weserv.nl...`);
    const resizeServiceUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrlForResize)}&w=600&h=600&q=90&output=jpg`;
    const resizedResponse = UrlFetchApp.fetch(resizeServiceUrl, { 'muteHttpExceptions': true });
      
    if (resizedResponse.getResponseCode() === 200) {
      Logger.log(`✅ Image successfully resized.`);
      return Utilities.base64Encode(resizedResponse.getBlob().getBytes());
    } else {
      Logger.log(`⚠️ Image resizing service failed (Code: ${resizedResponse.getResponseCode()}). Using original image.`);
      return originalBase64;
    }
  } catch (e) {
    Logger.log(`⚠️ An error occurred during image resizing: ${e}. Using original image.`);
    return originalBase64;
  } finally {
    if (tempFile) {
      try { tempFile.setTrashed(true); Logger.log('Temporary cover art file deleted.'); }
      catch (e) { Logger.log(`Failed to delete temporary file: ${e}`); }
    }
  }
}

// ===============================================================
//                       HELPER FUNCTIONS
// ===============================================================

/**
 * Normalizes a track query string from the AI for maximum search accuracy.
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
  cleanedQuery = cleanedQuery.replace(/[^a-z0-9\s-]/g, ' ').replace(/\s{2,}/g, ' ').trim();

  return cleanedQuery;
}

/**
 * Parses the raw string response from Gemini, cleaning up common formatting errors.
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
       "responseMimeType": "application/json"
     },
     "safetySettings": [
        { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
      ]
   };
  // Add responseSchema only if the model supports it
  if (model.includes('1.5')) {
      requestPayload.generationConfig.responseSchema = {"type": "array", "items": { "type": "string" }};
  }
  
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

/**
 * Calls the Hugging Face Inference API.
 * @param {string} imagePrompt - The text prompt for image generation.
 * @return {string | null} A Base64 encoded image or null on error.
 */
function callHuggingFaceApi_(imagePrompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('HUGGINGFACE_API_KEY');
  if (!apiKey) {
    Logger.log('Error: Hugging Face API key (HUGGINGFACE_API_KEY) not found.');
    return null;
  }
  
  const modelId = AI_CONFIG.IMAGE_GENERATION.SELECTED_MODEL_ID;
  const url = `https://api-inference.huggingface.co/models/${modelId}`;
  
  let payload = { "inputs": imagePrompt };
  
  // Special parameters for fast models
  if (modelId.includes('FLUX.1-schnell') || modelId.includes('sdxl-turbo')) {
    payload.parameters = {
      "num_inference_steps": 8,
      "guidance_scale": 0.0
    };
  }

  const options = {
    'method': 'post',
    'headers': {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    Logger.log(`Hugging Face: Sending generation request to model "${modelId}"...`);
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();

    if (responseCode === 200) {
      Logger.log(`✅ Image successfully generated via "${modelId}".`);
      const imageBlob = response.getBlob();
      return Utilities.base64Encode(imageBlob.getBytes());
    } else {
      const responseBody = response.getContentText();
      Logger.log(`Error calling Hugging Face API. Code: ${responseCode}. Body: ${responseBody}`);
      if (responseCode === 503) {
          Logger.log('The model on Hugging Face is currently loading. This can take a few minutes. The run should succeed next time.');
      }
      return null;
    }
  } catch (error) {
    Logger.log(`Exception during Hugging Face API call: ${error}`);
    return null;
  }
}

// ===============================================================
//                  OPTIONAL CLEANUP FUNCTION
// ===============================================================

/**
 * [IMPROVED VERSION] This function can be run on a schedule (e.g., hourly) to remove
 * tracks from the target playlist that you have recently listened to.
 */
function cleanUpPlaylist() {
  const playlistIdToClean = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
  Logger.log(`Cleanup Task: Starting for playlist ID: ${playlistIdToClean}`);

  try {
    const currentPlaylistTracks = Source.getPlaylistTracks('', playlistIdToClean);
    if (!currentPlaylistTracks || currentPlaylistTracks.length === 0) {
      Logger.log(`Cleanup Task: Playlist is empty. Finishing.`);
      return;
    }
    const initialTrackCount = currentPlaylistTracks.length;
    Logger.log(`Found ${initialTrackCount} tracks in playlist to check.`);

    Logger.log(`Cleanup Task: Getting listening history for the last ${AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS} days...`);
    let recentTracksHistory = RecentTracks.get();
    Filter.rangeDateRel(recentTracksHistory, AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS, 0);
    
    if (!recentTracksHistory || recentTracksHistory.length === 0) {
        Logger.log(`Cleanup Task: No listened tracks found in the specified period. No changes needed.`);
        return;
    }
    Logger.log(`Found ${recentTracksHistory.length} listened tracks for comparison.`);

    // Use a Set for fast and reliable comparison of track IDs
    const recentTrackIds = new Set(recentTracksHistory.map(track => track.id));
    const tracksToKeep = currentPlaylistTracks.filter(track => !recentTrackIds.has(track.id));
    
    const tracksToRemoveCount = initialTrackCount - tracksToKeep.length;

    if (tracksToRemoveCount > 0) {
      Logger.log(`Cleanup Task: ${tracksToRemoveCount} listened tracks will be removed. ${tracksToKeep.length} tracks will remain. Updating playlist...`);
      Playlist.saveWithReplace({ id: playlistIdToClean, tracks: tracksToKeep });
      Logger.log(`Cleanup Task: Playlist was successfully updated.`);
    } else {
      Logger.log(`Cleanup Task: No matches found. All tracks in the playlist remain. No changes needed.`);
    }
  } catch (error) {
    Logger.log(`Cleanup Task ERROR: ${error.toString()}\nStack: ${error.stack}`);
  }
}
