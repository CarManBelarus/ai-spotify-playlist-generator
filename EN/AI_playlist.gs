/**
 * @OnlyCurrentDoc
 * Main script for creating Spotify playlists using Gemini AI.
 * VERSION: "Golden Release" (Multi-Model Gemini + FLUX/SD3 Cover Art)
 * 
 * Features:
 * 1. Analyzes your library (SavedTracks.json).
 * 2. Generates recommendations via Google Gemini (with fallback models).
 * 3. Searches for tracks on Spotify (supports Latin & Cyrillic queries).
 * 4. Generates AI cover art via Hugging Face (FLUX/SD3).
 */

// ===============================================================
//                           CONFIGURATION
// ===============================================================

const AI_CONFIG = {
  // === REQUIRED SETTINGS ===
  
  // The ID of the Spotify playlist to update.
  // You can get this from the playlist URL: open.spotify.com/playlist/YOUR_ID
  SPOTIFY_PLAYLIST_ID: 'INSERT_YOUR_PLAYLIST_ID_HERE', 

  // === GEMINI SETTINGS (MULTI-MODEL FALLBACK) ===
  // Priority list of models. If the first one is overloaded (503), 
  // the script automatically tries the next one.
  GEMINI_MODELS_PRIORITY: [
    'gemini-2.5-pro',          // 1. "The Brain": Best quality & erudition
    'gemini-flash-latest',     // 2. "Speed": Current Flash version (Reliable fallback)
    'gemini-flash-lite-latest' // 3. "Light": Most economical (Last resort)
  ],

  // Number of tracks to analyze from your library (to avoid token limits)
  TRACK_SAMPLE_SIZE_FOR_AI: 500,

  // Maximum playlist size before removing old tracks.
  MAX_PLAYLIST_SIZE: 500, 

  // === COVER ART SETTINGS (VIA HUGGING FACE) ===
  IMAGE_GENERATION: {
      ENABLED: true,
      
      // "Golden List" of verified models. The script tries them sequentially.
      AVAILABLE_MODELS: {
        // 1. Top Quality & Detail (~10-15s). Requires license agreement on HF.
        FLUX_DEV: 'black-forest-labs/FLUX.1-dev', 
        
        // 2. Top Speed (~2-3s).
        FLUX_SCHNELL: 'black-forest-labs/FLUX.1-schnell', 
        
        // 3. Alternative Artistic Style (Stable Diffusion 3).
        SD3_MEDIUM: 'stabilityai/stable-diffusion-3-medium-diffusers',
        
        // 4. Reliable Classic (Works without extra licenses).
        SDXL_BASE: 'stabilityai/stable-diffusion-xl-base-1.0'
      }
  },

  // Playlist name template. {date} is replaced with the current date.
  PLAYLIST_NAME_TEMPLATE: 'AI Playlist from {date}',
  
  // Cleanup settings: remove tracks listened to more than X days ago.
  CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS: 60
};

// ===============================================================
//                MAIN GENERATION FUNCTION
// ===============================================================

/**
 * Runs the full cycle: Analysis -> Generation -> Search -> Update -> Cover Art.
 */
function generateAndCreateSpotifyPlaylist() {
  try {
    Logger.log('Starting AI playlist creation process...');
    const geminiApiKey = getGeminiApiKey_();
    
    // 1. Prepare Data
    const randomTracksJsonString = prepareTracksForPrompt_();
    if (!randomTracksJsonString) return; 

    Logger.log('Creating prompt for Gemini AI...');
    const promptText = createTrackRecommendationPrompt_(randomTracksJsonString);

    // 2. AI Call with Fallback Loop
    let aiResponseJsonString = null;
    let usedModel = '';

    for (const modelName of AI_CONFIG.GEMINI_MODELS_PRIORITY) {
      Logger.log(`🔄 Attempting model: "${modelName}"...`);
      aiResponseJsonString = callGeminiApi_(geminiApiKey, modelName, promptText);
      
      if (aiResponseJsonString) {
        Logger.log(`✅ Model "${modelName}" responded successfully.`);
        usedModel = modelName;
        break; 
      } else {
        Logger.log(`⚠️ Model "${modelName}" failed. Switching to next...`);
        Utilities.sleep(1000); // Pause before retry
      }
    }

    if (!aiResponseJsonString) throw new Error('❌ All Gemini models are unavailable.');

    // 3. Process Response
    Logger.log('Parsing AI response...');
    const tracksToSearch = parseAiResponse_(aiResponseJsonString);
    Logger.log(`AI (${usedModel}) recommended ${tracksToSearch.length} tracks.`);

    if (tracksToSearch.length === 0) {
        Logger.log('Track list is empty. Stopping.');
        return;
    }

    // ===============================================================
    //           SMART SEARCH (LATIN + CYRILLIC)
    // ===============================================================

    Logger.log('Preparing search queries...');
    const initialLatinQueries = [...new Set(tracksToSearch.map(track => normalizeTrackQuery_(track)).filter(q => q))];

    // --- Stage 1: Latin Search ---
    Logger.log(`[Stage 1] Searching ${initialLatinQueries.length} tracks (Latin)...`);
    let foundSpotifyTracks = Search.multisearchTracks(initialLatinQueries);
    
    // Identify missing tracks
    const foundTrackNames = new Set(foundSpotifyTracks.map(t => `${t.artists[0].name} ${t.name}`.toLowerCase()));
    const notFoundQueries = initialLatinQueries.filter(query => {
        return !Array.from(foundTrackNames).some(found => found.includes(query.split(' ')[1]));
    });

    // --- Stage 2: Cyrillic Fallback (for local music) ---
    if (notFoundQueries.length > 0) {
      Logger.log(`${notFoundQueries.length} tracks not found. Attempting Cyrillic transliteration...`);
      const cyrillicQueries = [];
      notFoundQueries.forEach(query => {
        const cyrillicGuess = reverseTransliterate_(query);
        if (cyrillicGuess) {
          cyrillicQueries.push(cyrillicGuess);
          Logger.log(`[Retry] "${query}" -> "${cyrillicGuess}"`);
        }
      });

      if (cyrillicQueries.length > 0) {
        const additionalFoundTracks = Search.multisearchTracks(cyrillicQueries);
        Logger.log(`[Stage 2] Found ${additionalFoundTracks.length} additional tracks.`);
        foundSpotifyTracks.push(...additionalFoundTracks);
      }
    }

    // Deduplicate results
    Filter.dedupTracks(foundSpotifyTracks);
    Logger.log(`Total unique tracks found: ${foundSpotifyTracks.length}.`);

    if (foundSpotifyTracks.length === 0) {
      Logger.log('No tracks found on Spotify.');
      return;
    }

    // 4. Update Playlist
    updatePlaylistIncrementally_(foundSpotifyTracks);
    Logger.log('🎉 Process completed successfully.');

  } catch (error) {
    Logger.log(`CRITICAL ERROR: ${error.toString()}`);
    Logger.log(`Stack: ${error.stack}`);
  }
}

// ===============================================================
//         PLAYLIST UPDATE & COVER ART
// ===============================================================

function updatePlaylistIncrementally_(foundSpotifyTracks) {
  Logger.log(`Fetching existing tracks...`);
  const existingPlaylistTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  
  // Keep only new unique tracks
  let newUniqueTracks = Selector.sliceCopy(foundSpotifyTracks);
  Filter.removeTracks(newUniqueTracks, existingPlaylistTracks);
  const newTracksCount = newUniqueTracks.length;
  Logger.log(`Found ${newTracksCount} new tracks to add.`);

  if (newTracksCount > 0) {
    Logger.log(`Adding ${newTracksCount} tracks in chunks...`);
    const CHUNK_SIZE = 100; // Spotify API limit
    for (let i = 0; i < newTracksCount; i += CHUNK_SIZE) {
      const chunk = newUniqueTracks.slice(i, i + CHUNK_SIZE);
      Logger.log(`Adding chunk: ${chunk.length} tracks...`);
      try {
        Playlist.saveWithAppend({
          id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
          tracks: chunk,
          position: 'begin' 
        });
        if (newTracksCount > CHUNK_SIZE) Utilities.sleep(2000);
      } catch (e) {
        Logger.log(`ERROR adding chunk: ${e}`);
      }
    }
    Logger.log('Tracks added.');
  }
  
  const finalTotalTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID).length;
  updatePlaylistDetailsAndCover_(newTracksCount, finalTotalTracks);
  trimPlaylistIfNeeded_();
}

function updatePlaylistDetailsAndCover_(addedCount, totalCount) {
    Logger.log('Generating and processing cover art...');
    let coverImageBase64 = null;
    let tempFile = null;
    
    try {
        // Generate
        coverImageBase64 = generatePlaylistCover_();
        
        if (coverImageBase64) {
            // Resize via external service (to ensure < 256KB)
            const imageBlob = Utilities.newBlob(Utilities.base64Decode(coverImageBase64), 'image/jpeg', 'temp_cover.jpg');
            tempFile = DriveApp.createFile(imageBlob);
            tempFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            const imageUrlForResize = `https://drive.google.com/uc?id=${tempFile.getId()}`;
            const resizeServiceUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrlForResize)}&w=600&h=600&q=90&output=jpg`;
            const resizedResponse = UrlFetchApp.fetch(resizeServiceUrl, { 'muteHttpExceptions': true });
            
            if (resizedResponse.getResponseCode() === 200) {
                coverImageBase64 = Utilities.base64Encode(resizedResponse.getBlob().getBytes());
                Logger.log(`✅ Image resized successfully.`);
            }
        }
    } catch (e) {
        Logger.log(`⚠️ Cover art error: ${e}`);
    } finally {
        if (tempFile) {
            try { tempFile.setTrashed(true); } catch (e) {}
        }
    }

    const playlistName = AI_CONFIG.PLAYLIST_NAME_TEMPLATE.replace('{date}', new Date().toLocaleDateString('en-US'));
    const formattedDateTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM dd, yyyy, HH:mm');

    const payload = {
      name: playlistName,
      description: `Last updated: ${formattedDateTime}. Added: ${addedCount} new. Total: ${totalCount}.`
    };

    Logger.log(`Updating metadata...`);
    try {
        SpotifyRequest.put(`${API_BASE_URL}/playlists/${AI_CONFIG.SPOTIFY_PLAYLIST_ID}`, payload);
        Logger.log('✅ Metadata updated.');
    } catch (e) { Logger.log(`⚠️ Metadata error: ${e}`); }

    if (coverImageBase64) {
        Logger.log('Uploading cover to Spotify...');
        try {
            SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${AI_CONFIG.SPOTIFY_PLAYLIST_ID}/images`, coverImageBase64);
            Logger.log('✅ Cover uploaded successfully.');
        } catch (e) { Logger.log(`⚠️ Upload error: ${e}`); }
    }
}

function trimPlaylistIfNeeded_() {
  Logger.log('Checking playlist size...');
  const currentTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  
  if (currentTracks.length > AI_CONFIG.MAX_PLAYLIST_SIZE) {
    const trimmedTracks = currentTracks.slice(0, AI_CONFIG.MAX_PLAYLIST_SIZE);
    Playlist.saveWithReplace({
      id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
      tracks: trimmedTracks
    });
    Logger.log(`✅ Playlist trimmed to ${AI_CONFIG.MAX_PLAYLIST_SIZE} tracks.`);
  } else {
    Logger.log('No trimming needed.');
  }
}

// ===============================================================
//                     PROMPT CREATION
// ===============================================================

function prepareTracksForPrompt_() {
  Logger.log('Reading SavedTracks.json...');
  const allTracks = Cache.read('SavedTracks.json');
  if (!allTracks || allTracks.length === 0) throw new Error('SavedTracks.json is empty. Check Goofy configuration.');
  const randomTracks = Selector.sliceRandom(allTracks, AI_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
  return JSON.stringify(randomTracks);
}

function createTrackRecommendationPrompt_(tracksJsonString) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return `
[Role]: Music Curator & Researcher.
[Context]: Today is ${today}. Analyze my taste from the JSON below.
[Input]: \`\`\`json ${tracksJsonString} \`\`\`
[Task]: Generate a list of 200 tracks for music discovery.
[Rules]:
- 70% match specific taste, 30% broad experiments (adjacent genres).
- 30% local scene (Belarus/Eastern Europe) if appropriate.
- Exclude: Russian language songs.
- No duplicates.
[Output]: EXCLUSIVELY a JSON array of strings "Artist - Track". No markdown.
[Example]: ["Molchat Doma - Sudno", "The Cure - A Forest"]
`;
}

/**
 * [GOLDEN VERSION] Generates cover art prioritizing Quality (FLUX DEV).
 */
function generatePlaylistCover_() {
  if (!AI_CONFIG.IMAGE_GENERATION.ENABLED) return null;

  try {
    const tracksForPrompt = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
    if (!tracksForPrompt || tracksForPrompt.length === 0) return null;

    const imagePrompt = createImagePromptFromTracks_(tracksForPrompt);
    if (!imagePrompt) return null;
    
    // Model Chain: Quality -> Speed -> Alternative -> Classic
    const modelFallbackChain = [
      AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.FLUX_DEV,     
      AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.FLUX_SCHNELL, 
      AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.SD3_MEDIUM,   
      AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.SDXL_BASE     
    ];

    let imageBase64 = null;

    for (const modelId of modelFallbackChain) {
      if (!modelId) continue;
      Logger.log(`🚀 Generating image via: "${modelId}"...`);
      imageBase64 = callHuggingFaceApiWithModel_(imagePrompt, modelId);
      if (imageBase64) {
        Logger.log(`✅ SUCCESS! Image generated by "${modelId}".`);
        return imageBase64; 
      } else {
        Logger.log(`⚠️ Model "${modelId}" failed. Trying next...`);
      }
    }
    return null;
  } catch (error) {
    Logger.log(`⚠️ Cover generation critical error: ${error.toString()}`);
    return null;
  }
}

/**
 * Creates an image prompt using Gemini Fallback loop.
 */
function createImagePromptFromTracks_(tracks) {
  const trackSample = Selector.sliceRandom(tracks, 50); 
  const trackListString = trackSample.map(t => `${t.artists[0].name} - ${t.name}`).join('\n');

  const promptForPrompt = `
[Role]: Visionary Art Director.
[Input]: List of music tracks.
${trackListString}
[Task]: Generate a SINGLE, highly-detailed prompt for a square album cover.
[Rules]:
1. Metaphorical/Abstract, not literal scenes.
2. Define Artistic Style (e.g., Surrealism, Glitch Art) and Color Palette.
3. Add technical keywords (8k, cinematic lighting, masterpiece).
[Output]: ONLY the prompt text. Length < 140 words.
`;

  try {
    const geminiApiKey = getGeminiApiKey_();
    let rawImagePrompt = null;
    
    for (const modelName of AI_CONFIG.GEMINI_MODELS_PRIORITY) {
      Logger.log(`🎨 Creating image prompt via: "${modelName}"...`);
      rawImagePrompt = callGeminiApi_(geminiApiKey, modelName, promptForPrompt);
      if (rawImagePrompt) break;
      Utilities.sleep(1000);
    }

    if (!rawImagePrompt) return null;

    try {
      const cleanString = rawImagePrompt.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanString);
      if (parsed && parsed.prompt) return parsed.prompt;
    } catch (e) {}
    
    return rawImagePrompt.replace(/`/g, '').trim();

  } catch (e) { return null; }
}

// ===============================================================
//                       HELPER FUNCTIONS
// ===============================================================

function normalizeTrackQuery_(rawQuery) {
  if (typeof rawQuery !== 'string') return "";
  let q = rawQuery.toLowerCase();
  q = q.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').replace(/ - /g, ' ');
  q = q.replace(/[^a-z0-9\s\u0400-\u04FF]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return q;
}

function reverseTransliterate_(translitQuery) {
  // Simplified reverse transliteration table
  const REVERSE_TABLE = {
    'shch':'шч','kh':'х','zh':'ж','ch':'ч','sh':'ш',
    'ya':'я','yu':'ю','ts':'ц','ia':'я','iu':'ю',
    'a':'а','b':'б','v':'в','g':'г','d':'д','e':'е','z':'з',
    'i':'і','k':'к','l':'л','m':'м','n':'н','o':'о','p':'п',
    'r':'р','s':'с','t':'т','u':'у','f':'ф','y':'ы'
  };
  
  if (/[а-яёіў]/.test(translitQuery)) return null;
  
  let cyr = translitQuery;
  for (const [lat, c] of Object.entries(REVERSE_TABLE)) {
     cyr = cyr.split(lat).join(c); 
  }
  return (cyr !== translitQuery && cyr.length > 2) ? cyr : null;
}

function parseAiResponse_(rawResponse) {
  let cleaned = rawResponse.replace(/^\s*[\*\-]\s*/gm, '').replace(/^```json\s*/, '').replace(/\s*```$/, '').replace(/,\s*\]/g, ']');
  try {
    let tracks = JSON.parse(cleaned);
    if (Array.isArray(tracks)) return tracks.filter(item => typeof item === 'string');
  } catch (e) { return []; }
  return [];
}

function getGeminiApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY is missing in Script Properties.');
  return key;
}

function callGeminiApi_(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = { 
      "contents": [{"parts": [{"text": prompt}]}], 
      "generationConfig": {"responseMimeType": "application/json"} 
  };
  
  try {
    const response = UrlFetchApp.fetch(url, {
        'method': 'post', 
        'contentType': 'application/json', 
        'payload': JSON.stringify(payload), 
        'muteHttpExceptions': true
    });
    
    if (response.getResponseCode() === 200) {
      const json = JSON.parse(response.getContentText());
      return json.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }
  } catch (e) {}
  return null;
}

/**
 * Universal Hugging Face API call with model-specific parameters.
 */
function callHuggingFaceApiWithModel_(imagePrompt, modelId) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('HUGGINGFACE_API_KEY');
  if (!apiKey) {
      Logger.log('HUGGINGFACE_API_KEY is missing!');
      return null;
  }

  const url = `https://router.huggingface.co/hf-inference/models/${modelId}`;
  const payload = { "inputs": imagePrompt, "parameters": {} };
  
  if (modelId.includes('FLUX.1-schnell')) {
    payload.parameters.num_inference_steps = 4; 
    payload.parameters.guidance_scale = 0.0;
  } else if (modelId.includes('FLUX.1-dev')) {
    payload.parameters.num_inference_steps = 25; 
    payload.parameters.guidance_scale = 3.5;
    payload.parameters.width = 1024; payload.parameters.height = 1024;
  } else if (modelId.includes('stable-diffusion-3')) {
    payload.parameters.num_inference_steps = 28; 
    payload.parameters.guidance_scale = 7.0;
    payload.parameters.width = 1024; payload.parameters.height = 1024;
  } else {
    payload.parameters.width = 1024; payload.parameters.height = 1024;
  }

  try {
    let response = UrlFetchApp.fetch(url, {
      'method': 'post', 'headers': {'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json'},
      'payload': JSON.stringify(payload), 'muteHttpExceptions': true
    });

    if (response.getResponseCode() === 503) {
      Logger.log(`⏳ Model loading... waiting 20s.`);
      Utilities.sleep(20000); 
      response = UrlFetchApp.fetch(url, {
        'method': 'post', 'headers': {'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json'},
        'payload': JSON.stringify(payload), 'muteHttpExceptions': true
      });
    }

    if (response.getResponseCode() === 200) {
      return Utilities.base64Encode(response.getBlob().getBytes());
    } else {
      Logger.log(`❌ API Error (${modelId}): ${response.getContentText()}`);
      return null;
    }
  } catch (error) { return null; }
}

function cleanUpPlaylist() {
  const playlistId = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
  Logger.log(`Cleanup Task: Starting...`);
  
  try {
    const playlistTracks = Source.getPlaylistTracks('', playlistId);
    if (!playlistTracks || playlistTracks.length === 0) return;

    Logger.log(`Getting history for ${AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS} days...`);
    let recentHistory = RecentTracks.get();
    Filter.rangeDateRel(recentHistory, AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS, 0);
    
    if (recentHistory.length === 0) {
        Logger.log(`No listened tracks found.`);
        return;
    }

    const recentIds = new Set(recentHistory.map(t => t.id));
    const tracksToKeep = playlistTracks.filter(t => !recentIds.has(t.id));
    
    if (tracksToKeep.length < playlistTracks.length) {
      const removedCount = playlistTracks.length - tracksToKeep.length;
      Logger.log(`Removing ${removedCount} tracks...`);
      Playlist.saveWithReplace({ id: playlistId, tracks: tracksToKeep });
      Logger.log(`✅ Playlist cleaned.`);
    } else {
      Logger.log(`No matches found.`);
    }
  } catch (e) {
    Logger.log(`Cleanup Error: ${e}`);
  }
}
