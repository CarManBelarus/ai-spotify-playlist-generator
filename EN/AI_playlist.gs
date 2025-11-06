/**
 * @OnlyCurrentDoc
 * Main file for working with the Gemini AI to create Spotify playlists.
 * This script analyzes your library, gets AI recommendations, and generates custom cover art.
 *
 * Version: 4.0 (Robust version with modular playlist updates, fallback chain for cover art generation,
 * and improved track normalization.)
 */

// ===============================================================
//                           CONFIGURATION
// ===============================================================

const AI_CONFIG = {
  // === REQUIRED SETTINGS ===

  // The ID of the Spotify playlist that will be updated.
  // Example: '78uFpogH6uDyrEbFxzfp2L'
  SPOTIFY_PLAYLIST_ID: 'YOUR_SPOTIFY_PLAYLIST_ID_HERE', // <<<=== PASTE YOUR PLAYLIST ID HERE

  // === AI & PLAYLIST SETTINGS ===

  // The Gemini model to use for generating track recommendations.
  GEMINI_MODEL: 'gemini-2.5-pro',

  // The number of random tracks from your library to be analyzed by the AI.
  TRACK_SAMPLE_SIZE_FOR_AI: 700,

  // The maximum size of the final playlist.
  MAX_PLAYLIST_SIZE: 500,

  // The template for the playlist name. {date} will be replaced with the current date.
  PLAYLIST_NAME_TEMPLATE: 'AI Playlist from {date}',

  // === COVER ART GENERATION SETTINGS (VIA HUGGING FACE) ===

  IMAGE_GENERATION: {
    ENABLED: true,
    // [RECOMMENDED MODELS] These models have been tested and provide good results.
    AVAILABLE_MODELS: {
      FLUX_SCHNELL: 'black-forest-labs/FLUX.1-schnell', // Best balance of speed and quality
      STABLE_DIFFUSION_3: 'stabilityai/stable-diffusion-3-medium-diffusers', // Highest quality
      DEFAULT_SDXL: 'stabilityai/stable-diffusion-xl-base-1.0' // Reliable classic
    }
  },

  // === PLAYLIST CLEANUP SETTINGS ===

  // The period (in days) for which listened tracks will be removed from the playlist.
  CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS: 60,
};

// ===============================================================
//                MAIN PLAYLIST GENERATION FUNCTION
// ===============================================================

/**
 * The main function to generate and update a Spotify playlist using Gemini AI.
 */
function generateAndCreateSpotifyPlaylist() {
  try {
    Logger.log('Starting the AI playlist creation process...');
    const geminiApiKey = getGeminiApiKey_();
    const randomTracksJsonString = prepareTracksForPrompt_();
    if (!randomTracksJsonString) return;

    Logger.log('Creating the prompt text for Gemini AI...');
    const promptText = createTrackRecommendationPrompt_(randomTracksJsonString);

    Logger.log(`Calling the ${AI_CONFIG.GEMINI_MODEL} model...`);
    const aiResponseJsonString = callGeminiApi_(geminiApiKey, AI_CONFIG.GEMINI_MODEL, promptText);
    if (!aiResponseJsonString) {
      throw new Error('Received an empty or invalid response from the Gemini API.');
    }

    const tracksToSearch = parseAiResponse_(aiResponseJsonString);
    if (tracksToSearch.length === 0) {
      Logger.log('AI returned no tracks to search for. Stopping execution.');
      return;
    }
    Logger.log(`AI recommended ${tracksToSearch.length} tracks to search for.`);

    const normalizedQueries = [...new Set(tracksToSearch.map(track => normalizeTrackQuery_(track)).filter(q => q))];

    Logger.log(`Searching for ${normalizedQueries.length} tracks on Spotify...`);
    let foundSpotifyTracks = Search.multisearchTracks(normalizedQueries);
    Filter.dedupTracks(foundSpotifyTracks);
    Logger.log(`Found a total of ${foundSpotifyTracks.length} unique tracks on Spotify.`);

    if (foundSpotifyTracks.length === 0) {
      Logger.log('No tracks were found on Spotify. Stopping execution.');
      return;
    }

    // Call the modular logic to update the playlist
    updatePlaylistIncrementally_(foundSpotifyTracks);

    Logger.log('✅ Playlist creation/update process completed successfully.');

  } catch (error) {
    Logger.log(`CRITICAL ERROR: ${error.toString()}`);
    Logger.log(`Stack Trace: ${error.stack}`);
  }
}

// ===============================================================
//                MODULAR PLAYLIST UPDATES
// ===============================================================

/**
 * Incrementally updates the playlist: adds new tracks and then triggers
 * metadata updates and trimming.
 * @param {Array<Object>} foundSpotifyTracks An array of new tracks to add.
 */
function updatePlaylistIncrementally_(foundSpotifyTracks) {
  const playlistId = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
  Logger.log(`Getting existing tracks from playlist ID: ${playlistId}...`);
  const existingPlaylistTracks = Source.getPlaylistTracks('', playlistId);
  
  let newUniqueTracks = Selector.sliceCopy(foundSpotifyTracks);
  Filter.removeTracks(newUniqueTracks, existingPlaylistTracks);
  const newTracksCount = newUniqueTracks.length;

  if (newTracksCount > 0) {
    Logger.log(`Found ${newTracksCount} new tracks. Starting chunked addition...`);
    const CHUNK_SIZE = 100; // Spotify API limit
    for (let i = 0; i < newTracksCount; i += CHUNK_SIZE) {
      const chunk = newUniqueTracks.slice(i, i + CHUNK_SIZE);
      Logger.log(`Adding chunk of ${chunk.length} tracks...`);
      try {
        Playlist.saveWithAppend({ id: playlistId, tracks: chunk, position: 'begin' });
        if (newTracksCount > CHUNK_SIZE) Utilities.sleep(1000); // Pause between requests
      } catch (e) {
        Logger.log(`ERROR during track chunk addition: ${e.toString()}`);
      }
    }
  } else {
    Logger.log('No new tracks to add.');
  }
  
  const finalTotalTracks = Source.getPlaylistTracks('', playlistId).length;

  // Update name, description, and cover art separately
  updatePlaylistDetailsAndCover_(newTracksCount, finalTotalTracks);
  
  // Run the check to trim the playlist
  trimPlaylistIfNeeded_();
}

/**
 * Updates the playlist's metadata (name, description) and cover art without affecting the track list.
 * Uses direct API calls to preserve the original "added on" dates for tracks.
 * @param {number} addedCount The number of tracks that were just added.
 * @param {number} totalCount The total number of tracks now in the playlist.
 */
function updatePlaylistDetailsAndCover_(addedCount, totalCount) {
    const playlistId = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
    const coverImageBase64 = generatePlaylistCover_();

    const playlistName = AI_CONFIG.PLAYLIST_NAME_TEMPLATE.replace('{date}', new Date().toLocaleDateString('en-US'));
    const formattedDateTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM dd, yyyy, HH:mm');

    const payload = {
      name: playlistName,
      description: `Last updated: ${formattedDateTime}. Added: ${addedCount} new. Total: ${totalCount}.`
    };

    Logger.log(`Updating name and description via direct API call...`);
    try {
        SpotifyRequest.put(`${API_BASE_URL}/playlists/${playlistId}`, payload);
        Logger.log('✅ Name and description successfully updated.');
    } catch (e) {
        Logger.log(`⚠️ Error during playlist details update: ${e.toString()}`);
    }

    if (coverImageBase64) {
        Logger.log('Uploading new cover art...');
        try {
            SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${playlistId}/images`, coverImageBase64);
            Logger.log('✅ Cover art successfully uploaded.');
        } catch (e) {
            Logger.log(`⚠️ Error during cover art upload: ${e.toString()}`);
        }
    }
}

/**
 * Checks the playlist size and trims it if it exceeds the `MAX_PLAYLIST_SIZE` limit.
 */
function trimPlaylistIfNeeded_() {
  const playlistId = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
  const currentTracks = Source.getPlaylistTracks('', playlistId);
  
  if (currentTracks.length > AI_CONFIG.MAX_PLAYLIST_SIZE) {
    const tracksToRemoveCount = currentTracks.length - AI_CONFIG.MAX_PLAYLIST_SIZE;
    Logger.log(`Playlist exceeds the limit (${AI_CONFIG.MAX_PLAYLIST_SIZE}). Removing ${tracksToRemoveCount} oldest tracks...`);
    
    const trimmedTracks = currentTracks.slice(0, AI_CONFIG.MAX_PLAYLIST_SIZE);
    
    Playlist.saveWithReplace({
      id: playlistId,
      tracks: trimmedTracks
    });
    Logger.log('Playlist successfully trimmed.');
  }
}

// ===============================================================
//                     AI PROMPT CREATION
// ===============================================================

function prepareTracksForPrompt_() {
  Logger.log('Getting tracks from Goofy Cache (SavedTracks.json)...');
  const allTracks = Cache.read('SavedTracks.json');
  if (!allTracks || allTracks.length === 0) {
    Logger.log('ERROR: Could not read tracks. Ensure Goofy is set up and has run at least once.');
    return null;
  }
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
- **Diversity:** ~70% of the recommendations should closely match the identified tastes, while ~30% should be a bold "step aside" (adjacent genres, different eras, geographies).
- **Genre Classics:** Be sure to include ~5 iconic hits from the dominant genre identified in the input data.
- **Local Scene:** About 30% of the artists in the final list should be from Belarus.
- **Language Filter:** Avoid songs in Russian.
[Output Format]:
- The response must be EXCLUSIVELY a valid JSON array. Each element is a string in the format "Artist Name - Track Title".
- Do not add any explanations, comments, or markdown.
- **VERY IMPORTANT FOR SEARCH ACCURACY:** All titles must be in lower case. Remove all special characters except for hyphens. Do not add metadata ('remastered', 'live').
[Example of perfect output]:
["the cure - a forest", "joy division - disorder", "molchat doma - sudno borys ryzhyi", "lavon volski - pavietrany shar"]
`;
}

// ===============================================================
//                     COVER ART GENERATION
// ===============================================================

/**
 * Attempts to generate cover art by sequentially trying models from a fallback chain for maximum reliability.
 * @return {string | null} A Base64 encoded image, or null if all attempts fail.
 */
function generatePlaylistCover_() {
  if (!AI_CONFIG.IMAGE_GENERATION.ENABLED) {
    Logger.log('Cover art generation is disabled in settings.');
    return null;
  }
  const tracksForPrompt = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  if (!tracksForPrompt || tracksForPrompt.length === 0) {
    Logger.log('Playlist is empty, skipping cover art generation.');
    return null;
  }

  const imagePrompt = createImagePromptFromTracks_(tracksForPrompt);
  if (!imagePrompt) {
    Logger.log('Failed to create an image prompt.');
    return null;
  }
  
  // A fallback chain of models to ensure reliable generation
  const modelFallbackChain = [
    AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.FLUX_SCHNELL,
    AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.STABLE_DIFFUSION_3,
    AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.DEFAULT_SDXL
  ];

  for (const modelId of modelFallbackChain) {
    const imageBase64 = callHuggingFaceApiWithModel_(imagePrompt, modelId);
    if (imageBase64) {
      Logger.log(`✅ Image successfully generated using "${modelId}".`);
      return imageBase64; // Return the result of the first successful generation
    }
  }
  
  Logger.log('❌ All models in the fallback chain failed to generate an image.');
  return null;
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
- **Style:** Suggest a specific, evocative visual style: "cinematic still", "lomography photo", "double exposure", "surrealism".
- **Lighting & Composition:** Describe lighting in detail: "cinematic lighting", "volumetric light", "moody".
- **Atmosphere:** Focus on abstract emotions, not literal scenes.
- **Brevity:** The final prompt must be a single, concise paragraph under 120 words and in English.
[Output Format]: ONLY the text of the prompt itself. No explanations or quotes.
`;
  try {
    const geminiApiKey = getGeminiApiKey_();
    // Use a fast model to generate the prompt
    const imagePromptText = callGeminiApi_(geminiApiKey, 'gemini-2.5-flash', promptForPrompt); 
    return imagePromptText ? imagePromptText.replace(/[`"']/g, '').trim() : null;
  } catch (e) {
    Logger.log(`Failed to create the image prompt: ${e}`);
    return null;
  }
}

// ===============================================================
//                       HELPER FUNCTIONS
// ===============================================================

/**
 * Calls the Hugging Face Inference API. Uses the updated `router.huggingface.co` endpoint for
 * compatibility. Implements a retry mechanism for 503 errors, which indicate a model "cold start".
 * @param {string} imagePrompt - The text prompt for image generation.
 * @param {string} modelId - The ID of the model on Hugging Face.
 * @return {string | null} A Base64 encoded image or null on error.
 */
function callHuggingFaceApiWithModel_(imagePrompt, modelId) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('HUGGINGFACE_API_KEY');
  if (!apiKey) {
    Logger.log('Error: Hugging Face API key (HUGGINGFACE_API_KEY) not found.');
    return null;
  }

  // Use the new, mandatory URL for the Hugging Face Inference API
  const url = `https://router.huggingface.co/hf-inference/models/${modelId}`;

  const payload = { 
    "inputs": imagePrompt, 
    "parameters": {} 
  };
  
  if (modelId.includes('FLUX.1-schnell')) {
    payload.parameters.num_inference_steps = 8;
    payload.parameters.guidance_scale = 0.0;
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
    Logger.log(`Sending generation request to model "${modelId}"...`);
    let response = UrlFetchApp.fetch(url, options);
    let responseCode = response.getResponseCode();

    // Automatically retry if the model is loading ("cold start")
    if (responseCode === 503) {
      Logger.log('The model on Hugging Face is loading. Waiting 20 seconds and retrying...');
      Utilities.sleep(20000); 
      response = UrlFetchApp.fetch(url, options);
      responseCode = response.getResponseCode();
    }

    if (responseCode === 200) {
      const imageBlob = response.getBlob();
      return Utilities.base64Encode(imageBlob.getBytes());
    } else {
      const responseBody = response.getContentText();
      Logger.log(`Error calling Hugging Face API for "${modelId}". Code: ${responseCode}. Body: ${responseBody}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Exception during Hugging Face API call for "${modelId}": ${error}`);
    return null;
  }
}

/**
 * Normalizes a track query string for maximum search accuracy.
 * Includes transliteration from Cyrillic and handles diacritics (e.g., 'é' -> 'e').
 * @param {string} rawQuery - The raw string from the AI.
 * @return {string} A cleaned string ready for searching.
 */
function normalizeTrackQuery_(rawQuery) {
  if (typeof rawQuery !== 'string' || rawQuery.length === 0) return "";
  const TRANSLIT_TABLE = { 'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'i','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'iu','я':'ia','і':'i','ў':'u','ґ':'g','є':'ie','ї':'i' };
  const DIACRITICS_MAP = { 'ä':'a', 'á':'a', 'à':'a', 'â':'a', 'ã':'a', 'å':'a','ç':'c', 'ć':'c', 'č':'c','é':'e', 'è':'e', 'ê':'e', 'ë':'e','í':'i', 'ì':'i', 'î':'i', 'ï':'i','ł':'l','ñ':'n', 'ń':'n','ö':'o', 'ó':'o', 'ò':'o', 'ô':'o', 'õ':'o', 'ø':'o','š':'s', 'ś':'s','ü':'u', 'ú':'u', 'ù':'u', 'û':'u','ý':'y','ž':'z', 'ź':'z', 'ż':'z' };

  let cleanedQuery = rawQuery.toLowerCase();
  cleanedQuery = cleanedQuery.split('').map(char => TRANSLIT_TABLE[char] || DIACRITICS_MAP[char] || char).join('');
  cleanedQuery = cleanedQuery.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').trim();
  const noiseWords = ['remastered', 'remaster', 'live', 'radio edit', 'album version', 'feat', 'ft'];
  noiseWords.forEach(word => { cleanedQuery = cleanedQuery.replace(new RegExp(`\\b${word}\\b`, 'gi'), ''); });
  cleanedQuery = cleanedQuery.replace(/^the\s+/, '');
  cleanedQuery = cleanedQuery.replace(/[^a-z0-9\s-]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return cleanedQuery;
}

function parseAiResponse_(rawResponse) {
  let cleanedJsonString = rawResponse.replace(/^\s*[\*\-]\s*/gm, '').replace(/^```json\s*/, '').replace(/\s*```$/, '').replace(/,\s*\]/g, ']');
  try {
    let tracks = JSON.parse(cleanedJsonString);
    if (!Array.isArray(tracks)) throw new Error("AI response is not an array.");
    const validTracks = tracks.filter(item => typeof item === 'string' && item.trim().length > 0);
    if (validTracks.length !== tracks.length) {
      Logger.log(`Warning: ${tracks.length - validTracks.length} invalid items were removed from AI response.`);
    }
    return validTracks;
  } catch (e) {
    Logger.log(`CRITICAL parsing error: ${e.message}\nRaw response: ${rawResponse}`);
    return [];
  }
}

function getGeminiApiKey_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error("API Key 'GEMINI_API_KEY' not found in Script Properties.");
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
  if (model.includes('2.5')) {
      requestPayload.generationConfig.responseSchema = {"type": "array", "items": { "type": "string" }};
  }
  const options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(requestPayload), 'muteHttpExceptions': true };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();
  if (responseCode === 200) {
    const jsonResponse = JSON.parse(responseBody);
    if (jsonResponse.candidates && jsonResponse.candidates[0]?.content?.parts[0]?.text) {
        return jsonResponse.candidates[0].content.parts[0].text;
    }
  }
  Logger.log(`Error calling Gemini API. Code: ${responseCode}. Body: ${responseBody}`);
  return null;
}

// ===============================================================
//                  OPTIONAL CLEANUP FUNCTION
// ===============================================================

function cleanUpPlaylist() {
  const playlistId = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
  Logger.log(`Cleanup Task: Starting for playlist ID: ${playlistId}`);
  try {
    const playlistTracks = Source.getPlaylistTracks('', playlistId);
    if (playlistTracks.length === 0) {
      Logger.log(`Cleanup Task: Playlist is empty. Finishing.`);
      return;
    }
    const initialTrackCount = playlistTracks.length;

    Logger.log(`Cleanup Task: Getting listening history for the last ${AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS} days...`);
    let recentTracksHistory = RecentTracks.get();
    Filter.rangeDateRel(recentTracksHistory, AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS, 0);
    
    if (recentTracksHistory.length === 0) {
        Logger.log(`Cleanup Task: No listened tracks found in the specified period. No changes needed.`);
        return;
    }

    const recentTrackIds = new Set(recentTracksHistory.map(track => track.id));
    const tracksToKeep = playlistTracks.filter(track => !recentTrackIds.has(track.id));
    const tracksToRemoveCount = initialTrackCount - tracksToKeep.length;

    if (tracksToRemoveCount > 0) {
      Logger.log(`Cleanup Task: ${tracksToRemoveCount} listened tracks will be removed. Updating playlist...`);
      Playlist.saveWithReplace({ id: playlistId, tracks: tracksToKeep });
      Logger.log(`✅ Cleanup Task: Playlist was successfully updated.`);
    } else {
      Logger.log(`Cleanup Task: No matches found. No changes needed.`);
    }
  } catch (error) {
    Logger.log(`Cleanup Task ERROR: ${error.toString()}`);
  }
}
