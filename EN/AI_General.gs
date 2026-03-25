/**
 * @OnlyCurrentDoc
 * AI_General.gs - Central repository for global AI/Search settings and shared functions.
 */

// =========================================================================
// 1. GLOBAL AI CONFIGURATION
// =========================================================================
const GLOBAL_AI_CONFIG = {
  // List of Gemini models for text generation (from best quality to fastest)
  TEXT_MODELS_PRIORITY:[
    'gemini-3.1-pro-preview',
    'gemini-3-pro-preview',
    'gemini-2.5-pro',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-flash-latest'
  ],

  // Cover art generation settings
  IMAGE: {
    ENABLED: true,
    GEMINI_MODEL: "gemini-3.1-flash-image-preview", 
    POLLINATIONS_MODEL: 'flux' // Fallback model
  }  
};

// =========================================================================
// 2. TEXT AI ENGINE (GEMINI)
// =========================================================================

function getGeminiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error("API key 'GEMINI_API_KEY' not found in Script Properties.");
  return key;
}

/**
 * Universal call to Gemini to get a JSON array of tracks.
 * Iterates through the list of models until a valid response is received.
 */
function callGeminiTextAPI(promptText) {
  const apiKey = getGeminiKey_();
  let aiResponse = null;
  let usedModel = '';

  for (const modelName of GLOBAL_AI_CONFIG.TEXT_MODELS_PRIORITY) {
    Logger.log(`🔄 Attempting to call model: "${modelName}"...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    const payload = {
       "contents": [{"parts":[{"text": promptText}]}],
       "generationConfig": {
         "temperature": 1.1,
         "responseMimeType": "application/json"
       },
       "safetySettings":[
          { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
          { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
          { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
          { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
        ]
     };

    const options = { 
      'method': 'post', 
      'contentType': 'application/json', 
      'payload': JSON.stringify(payload), 
      'muteHttpExceptions': true 
    };

    try {
      const response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() === 200) {
        const json = JSON.parse(response.getContentText());
        if (json.candidates && json.candidates[0].content) {
          aiResponse = json.candidates[0].content.parts[0].text;
          usedModel = modelName;
          Logger.log(`✅ Model "${modelName}" successfully generated the list.`);
          break; // Success!
        }
      } else {
        Logger.log(`⚠️ Model "${modelName}" is unavailable (Code: ${response.getResponseCode()}). Moving to next...`);
        Utilities.sleep(1000);
      }
    } catch (e) {
      Logger.log(`⚠️ Connection error with model "${modelName}": ${e}`);
    }
  }

  if (!aiResponse) throw new Error('❌ All Gemini models are unavailable.');
  
  return { responseText: aiResponse, model: usedModel };
}

/**
 * Cleans and parses the AI response.
 */
function parseAiResponse(rawResponse) {
  let cleanedJson = rawResponse.replace(/^[\s\S]*?\[/, '[').replace(/\][\s\S]*$/, ']');
  try {
    let tracks = JSON.parse(cleanedJson);
    if (!Array.isArray(tracks)) throw new Error("Response is not an array");
    return tracks.filter(item => typeof item === 'string' && item.trim().length > 0);
  } catch (e) {
    Logger.log(`❌ Parsing error: ${e.message}\nRaw response: ${rawResponse}`);
    return[];
  }
}

// =========================================================================
// 3. IMAGE ENGINE (COVER ART)
// =========================================================================

/**
 * Main function for generating and applying playlist covers.
 */
function generateAndApplyCover(playlistId, tracks) {
  if (!GLOBAL_AI_CONFIG.IMAGE.ENABLED) return;
  
  Logger.log('🎨 Starting cover art generation...');
  const prompt = buildImagePrompt_(tracks);
  if (!prompt) return;

  let coverBase64 = callGeminiImageGen_(prompt);
  
  if (!coverBase64) {
    Logger.log('⚠️ Switching to fallback image generator (Pollinations)...');
    coverBase64 = callPollinationsImageGen_(prompt);
  }

  if (coverBase64) {
    Logger.log('Uploading new cover to Spotify...');
    try {
      SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${playlistId}/images`, coverBase64);
      Logger.log('✅ Cover uploaded successfully.');
    } catch (e) {
      Logger.log(`⚠️ Cover upload error: ${e}`);
    }
  } else {
    Logger.log('❌ Failed to generate cover art.');
  }
}

function buildImagePrompt_(tracks) {
  const trackSample = Selector.sliceRandom(tracks, 50).map(t => `${t.artists[0].name} - ${t.name}`).join('\n');
  const instruction  = `
<system_instruction>
    <role>
        You are an Elite Synesthetic Art Director and Master Prompt Engineer for Text-to-Image AI models (e.g., Midjourney, DALL-E). Your unparalleled expertise lies in translating the acoustic, rhythmic, and emotional signature of music into breathtaking, metaphorical, and highly textured visual concepts. You do not depict music literally; you feel it as architecture, light, color, and abstraction.
    </role>

    <objective>
        Analyze the emotional weight, tempo, and genre implications of the provided 50-track playlist, and synthesize its core "vibe" into a single, masterfully crafted text-to-image prompt for a square album cover.
    </objective>

    <context_awareness>
        Treat the following tracklist not as text, but as an emotional landscape. Identify the underlying mood (e.g., aggressive brutalism, ethereal melancholy, nostalgic warmth, frantic neon) to dictate the visual translation.
        [Input Tracks]:
        ${trackSample}
    </context_awareness>

    <behavioral_guidelines>
        1. **Conceptual Core:** Build the prompt around a central, evocative metaphor or abstract scene (e.g., "The memory of a forgotten dream," "A glitch in a serene landscape," "Quiet energy before a storm").
        2. **Artistic Direction (Choose ONE):** Select a bold, definitive visual style. Do not default to generic photorealism. Choose from:
            - *Photography:* Macro, lomography, long exposure, infrared, tilt-shift, double exposure.
            - *Art Movements:* Abstract expressionism, brutalist architecture, bauhaus design, surrealism.
            - *Illustration:* Vintage sci-fi cover, Japanese woodblock, technical drawing, charcoal sketch.
            - *Digital/FX:* Glitch art, volumetric light, datamoshing, generative art.
        3. **Composition & Lighting:** Specify the spatial arrangement (minimalist, chaotic, symmetrical, Dutch angle) and the exact lighting conditions (harsh noon sun, soft morning mist, flickering neon, dramatic chiaroscuro).
        4. **Color Palette:** Define a strict, descriptive color scheme crucial for the mood (e.g., "A muted palette of cold blues and greys," "Acidic neon pink and cyan," "Warm earthy ochre and burnt sienna").
        5. **The Wildcard Element:** Inject one unexpected, surreal, or abstract element to break the norm and create a unique signature (e.g., "floating geometric shapes of liquid metal," "flora made of shattered glass").
        6. **Technical Polish:** Conclude the prompt with 2-3 precise technical keywords matching the chosen style (e.g., "shot on Portra 400, f/1.8" for photos; "thick impasto, visible brushstrokes" for paintings; "8k, octane render" for 3D/digital).
    </behavioral_guidelines>

    <strict_constraints>
        * **NO LITERAL TRANSLATIONS:** NEVER include musical instruments (guitars, headphones, pianos), musical notes, vinyl records, or the names of the artists/tracks in the image prompt.
        * **FORMAT & LENGTH:** The final output must be EXACTLY ONE paragraph. It MUST be under 140 words.
        * **LANGUAGE:** The prompt MUST be written entirely in English.
        * **NO FILLER TEXT:** Output ONLY the raw image prompt. No introductory words, no explanations, no formatting tags, and no quotation marks.
    </strict_constraints>

    <interaction_style>
        Highly descriptive, syntactically optimized for diffusion models, evocative, and strictly functional.
    </interaction_style>
</system_instruction>
`;
  
  try {
    const result = callGeminiTextAPI(instruction);
    let prompt = result.responseText.replace(/```json|```/g, '').trim();
    try {
      const parsed = JSON.parse(prompt);
      if (parsed.prompt) prompt = parsed.prompt;
    } catch(e) {} // It's just raw text
    
    Logger.log(`✅ Image prompt created: "${prompt.substring(0, 50)}..."`);
    return prompt;
  } catch (e) {
    Logger.log(`⚠️ Failed to create image prompt: ${e}`);
    return null;
  }
}

function callGeminiImageGen_(prompt) {
  Logger.log(`🎨 [1/2] Generating via Gemini (${GLOBAL_AI_CONFIG.IMAGE.GEMINI_MODEL})...`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GLOBAL_AI_CONFIG.IMAGE.GEMINI_MODEL}:generateContent?key=${getGeminiKey_()}`;
  
  const payload = {
    "contents": [{ "parts": [{ "text": prompt }] }],
    "generationConfig": {
      "responseModalities": ["IMAGE"],
      "imageConfig": { "aspectRatio": "1:1", "imageSize": "1024x1024" }
    }
  };

  try {
    const response = UrlFetchApp.fetch(url, { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(payload), 'muteHttpExceptions': true });
    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      if (imagePart?.inlineData?.data) {
        // Compress PNG -> JPEG to bypass Spotify limits
        let originalBlob = Utilities.newBlob(Utilities.base64Decode(imagePart.inlineData.data), 'image/png');
        let jpegBlob = originalBlob.getAs('image/jpeg');
        Logger.log(`📉 Image compressed. New size: ~${Math.round(jpegBlob.getBytes().length / 1024)} KB`);
        return Utilities.base64Encode(jpegBlob.getBytes());
      }
    }
    return null;
  } catch (e) { return null; }
}

function callPollinationsImageGen_(prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&model=${GLOBAL_AI_CONFIG.IMAGE.POLLINATIONS_MODEL}&seed=${Math.floor(Math.random() * 1000000)}&nologo=true`;
  try {
    const response = UrlFetchApp.fetch(url, { 'muteHttpExceptions': true });
    if (response.getResponseCode() === 200) {
      return Utilities.base64Encode(response.getBlob().getBytes());
    }
    return null;
  } catch (e) { return null; }
}

// =========================================================================
// 4. BULLETPROOF SPOTIFY SEARCH
// =========================================================================

function executeSmartSearch(rawAiTracks) {
  if (!rawAiTracks || rawAiTracks.length === 0) return[];
  let allFoundTracks = [], notFoundQueries =[];

  Logger.log('\n--- LEVEL 1: Search by original query ---');
  let stage1Results = fetchSpotifyTracksCustom_(rawAiTracks);
  let stage2Queries = [], stage2Originals =[];

  for (let i = 0; i < rawAiTracks.length; i++) {
    let match = findBestMatchCustom_(rawAiTracks[i], stage1Results[i]);
    if (match) {
      allFoundTracks.push(match);
      Logger.log(`✅ [Lvl 1] Found: "${rawAiTracks[i]}" -> ${match.artists[0].name} - ${match.name}`);
    } else {
      stage2Originals.push(rawAiTracks[i]);
      stage2Queries.push(translitCyrillicToLatinCustom_(rawAiTracks[i].toLowerCase()));
    }
  }

  if (stage2Queries.length > 0) {
    Logger.log(`\n--- LEVEL 2: Transliteration (${stage2Queries.length} tracks) ---`);
    let stage2Results = fetchSpotifyTracksCustom_(stage2Queries);
    let stage3Originals = [], stage3Queries =[];

    for (let i = 0; i < stage2Queries.length; i++) {
      let match = findBestMatchCustom_(stage2Queries[i], stage2Results[i], stage2Originals[i]);
      if (match) {
        allFoundTracks.push(match);
        Logger.log(`✅ [Lvl 2] Found: "${stage2Originals[i]}" -> ${match.artists[0].name} - ${match.name}`);
      } else {
        stage3Originals.push(stage2Originals[i]);
        let parts = stage2Queries[i].split('-');
        stage3Queries.push(parts.length > 1 ? parts[1].trim() : stage2Queries[i]);
      }
    }

    if (stage3Queries.length > 0) {
      Logger.log(`\n--- LEVEL 3: Song title only (${stage3Queries.length} tracks) ---`);
      let stage3Results = fetchSpotifyTracksCustom_(stage3Queries);
      for (let i = 0; i < stage3Queries.length; i++) {
        let match = findBestMatchCustom_(stage3Queries[i], stage3Results[i], stage3Originals[i], true);
        if (match) {
          allFoundTracks.push(match);
          Logger.log(`✅[Lvl 3] Found: "${stage3Originals[i]}" -> ${match.artists[0].name} - ${match.name}`);
        } else {
          notFoundQueries.push(stage3Originals[i]);
        }
      }
    }
  }

  const uniqueTracks =[];
  const seenIds = new Set();
  allFoundTracks.forEach(t => {
    if (!seenIds.has(t.id)) { seenIds.add(t.id); uniqueTracks.push(t); }
  });

  if (notFoundQueries.length > 0) {
    Logger.log(`\n⚠️ Not found (Hallucinations): ${notFoundQueries.length} tracks.`);
  }

  return uniqueTracks;
}

function fetchSpotifyTracksCustom_(queries) {
  let urls = queries.map(q => `https://api.spotify.com/v1/search?q=${encodeURIComponent(q.substring(0, 100))}&type=track&limit=5`);
  return SpotifyRequest.getAll(urls).map(res => {
    if (res && res.tracks && res.tracks.items) return res.tracks.items;
    if (res && res.items) return res.items;
    return[];
  });
}

/**
 * Smart search for the best match with INDEPENDENT check of artist and title
 */
function findBestMatchCustom_(query, tracks, originalQuery = null, isTitleOnly = false) {
  if (!tracks || tracks.length === 0) return null;

  let bestTrack = null;
  let bestScore = 0;

  // 1. Try to split original query into Artist and Title (by hyphen)
  let baseQuery = originalQuery || query;
  let queryParts = baseQuery.split('-');
  
  let qArtist = queryParts.length > 1 ? normalizeStrictCustom_(queryParts[0]) : "";
  let qTitle = queryParts.length > 1 ? normalizeStrictCustom_(queryParts.slice(1).join('-')) : normalizeStrictCustom_(baseQuery);
  let qNormFull = normalizeStrictCustom_(query);

  for (let i = 0; i < Math.min(tracks.length, 5); i++) {
    let track = tracks[i];
    if (!track || !track.artists || track.artists.length === 0) continue;

    let tArtist = normalizeStrictCustom_(track.artists[0].name);
    let tTitle = normalizeStrictCustom_(track.name);
    let tNormFull = normalizeStrictCustom_(`${track.artists[0].name} ${track.name}`);

    // --- ANTI-COVER FILTER ---
    // If our query didn't contain cover/karaoke/tribute, reject such results from Spotify
    let rawTrackName = track.name.toLowerCase();
    let rawQuery = baseQuery.toLowerCase();
    if (!rawQuery.includes("cover") && !rawQuery.includes("karaoke") && !rawQuery.includes("tribute")) {
        if (rawTrackName.includes("karaoke") || rawTrackName.includes("tribute") || 
            track.artists[0].name.toLowerCase().includes("karaoke") || 
            track.artists[0].name.toLowerCase().includes("tribute")) {
            continue; // Skip this track
        }
    }

    let score = 0;

    // --- SEPARATE EVALUATION ---
    if (qArtist && qTitle) {
        let artistScore = compareStringsCustom_(qArtist, tArtist);
        let titleScore = compareStringsCustom_(qTitle, tTitle);

        // STRICT ARTIST FILTER: If the artist doesn't match even partially
        if (artistScore < 0.4 && !tArtist.includes(qArtist) && !qArtist.includes(tArtist)) {
            continue; 
        }

        // STRICT TITLE FILTER: If the title doesn't match at all
        if (titleScore < 0.4 && !tTitle.includes(qTitle) && !qTitle.includes(tTitle)) {
            continue; 
        }

        // If both filters passed, calculate total score (title is slightly more important)
        score = (artistScore * 0.45) + (titleScore * 0.55);
    } else {
        // If couldn't split by hyphen, calculate total score
        score = compareStringsCustom_(qNormFull, tNormFull);
    }

    // --- PENALTY FOR LEVEL 3 ---
    if (isTitleOnly && originalQuery) {
      if (qArtist && !tArtist.includes(qArtist) && !qArtist.includes(tArtist)) {
        score -= 0.5; // Drop score if searching by title but band is completely wrong
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestTrack = track;
    }
  }

  // Raise minimum threshold to 0.65 (65% match) to filter out garbage
  return bestScore >= 0.65 ? bestTrack : null;
}

function normalizeStrictCustom_(str) {
  if (!str) return "";
  let s = str.toLowerCase().replace(/\s*[\(\[].*?[\)\]]\s*/g, ''); 
  s = translitCyrillicToLatinCustom_(s);
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
}

function translitCyrillicToLatinCustom_(text) {
  if (!text) return "";
  const map = { 'а':'a','б':'b','в':'v','г':'h','д':'d','е':'je','ё':'jo','ж':'zh','з':'z','і':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ў':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ы':'y','ь':'','э':'e','ю':'ju','я':'ja','ґ':'g', 'ъ':'ie' };
  return text.split('').map(char => map[char] || char).join('');
}

function compareStringsCustom_(first, second) {
  first = first.replace(/\s+/g, ''); second = second.replace(/\s+/g, '');
  if (first === second) return 1; 
  if (first.length < 2 || second.length < 2) return 0; 
  let firstBigrams = new Map();
  for (let i = 0; i < first.length - 1; i++) {
    const bigram = first.substring(i, i + 2);
    firstBigrams.set(bigram, (firstBigrams.get(bigram) || 0) + 1);
  }
  let intersectionSize = 0;
  for (let i = 0; i < second.length - 1; i++) {
    const bigram = second.substring(i, i + 2);
    const count = firstBigrams.get(bigram) || 0;
    if (count > 0) { firstBigrams.set(bigram, count - 1); intersectionSize++; }
  }
  return (2.0 * intersectionSize) / (first.length + second.length - 2);
}

// =========================================================================
// 5. UNIVERSAL PLAYLIST CLEANUP
// =========================================================================

/**
 * Removes tracks from the playlist that have been listened to in the last N days.
 * @param {string} playlistId - Spotify Playlist ID
 * @param {number} days - Number of history days to analyze
 */
function cleanPlaylistFromRecentTracks(playlistId, days) {
  if (!playlistId) {
    Logger.log('❌ Error: Playlist ID is not specified.');
    return;
  }
  
  Logger.log(`🧹 Starting playlist cleanup (ID: ${playlistId}). Analyzing last ${days} days...`);
  
  try {
    const currentTracks = Source.getPlaylistTracks('', playlistId);
    if (!currentTracks || currentTracks.length === 0) {
      Logger.log('ℹ️ Playlist is empty. Cleanup not required.');
      return;
    }
    
    const initialCount = currentTracks.length;
    Logger.log(`Found ${initialCount} tracks in the playlist.`);
    
    // Get listening history (from goofy cache)
    let recentTracks = RecentTracks.get(); 
    if (!recentTracks || recentTracks.length === 0) {
      Logger.log('ℹ️ Listening history is empty.');
      return;
    }
    
    // Filter history by date (remove everything older than specified days)
    Filter.rangeDateRel(recentTracks, days, 0);
    
    // Create Set for fast lookup of listened IDs
    const recentIds = new Set(recentTracks.map(t => t.id));
    
    // Keep only tracks that are NOT in history
    const tracksToKeep = currentTracks.filter(t => !recentIds.has(t.id));
    const finalCount = tracksToKeep.length;
    const removedCount = initialCount - finalCount;
    
    if (removedCount > 0) {
      Logger.log(`🗑️ Found ${removedCount} recently listened tracks. Removing...`);
      Playlist.saveWithReplace({
        id: playlistId,
        tracks: tracksToKeep
      });
      Logger.log(`✅ Cleanup complete. Remaining tracks: ${finalCount}`);
    } else {
      Logger.log('✅ No matches found. All tracks are "fresh", nothing removed.');
    }
  } catch (e) {
    Logger.log(`❌ Cleanup error: ${e.toString()}`);
  }
}

// =========================================================================
// 6. FLOWSORT INTEGRATION (SMART SORTING)
// =========================================================================

/**
 * Applies FlowSort algorithm to the entire playlist.
 * @param {string} playlistId - Spotify Playlist ID
 * @param {string} preset - Preset name ('atmospheric', 'drive', 'radio')
 */
function applySmartSort(playlistId, preset = 'atmospheric') {
  if (!playlistId) return;
  Logger.log(`🌊 Starting FlowSort smart sorting for playlist (ID: ${playlistId})...`);
  
  try {
    // Check if FlowSort object exists
    if (typeof FlowSort === 'undefined' || !FlowSort.sortBalancedWave) {
       Logger.log('❌ Error: FlowSort object not found. Ensure you have added the code from FlowSort.gs to your project.');
       return;
    }

    const tracks = Source.getPlaylistTracks('', playlistId);
    
    if (!tracks || tracks.length < 4) {
      Logger.log('ℹ️ Too few tracks to sort (need at least 4). Skipping.');
      return;
    }

    let weights = {};
    if (preset === 'atmospheric') {
      // Ideal for post-punk, indie, ambient (keeps rhythm, max focus on harmony)
      weights = { tempo: 0.40, harmony: 0.55, energy: 0.05, valence: 0.0 };
    } else if (preset === 'drive') {
      // For steady beat, sports, electronic
      weights = { tempo: 0.80, harmony: 0.15, energy: 0.05, valence: 0.0 };
    } else {
      // 'radio' - balanced
      weights = { tempo: 0.50, harmony: 0.30, energy: 0.15, valence: 0.05 };
    }

    const sortedTracks = FlowSort.sortBalancedWave(tracks, { weights: weights });
    
    Playlist.saveWithReplace({
      id: playlistId,
      tracks: sortedTracks
    });
    
    Logger.log('✅ Playlist successfully sorted into a perfect sound wave!');
  } catch (e) {
    Logger.log(`❌ Error during sorting: ${e.toString()}`);
  }
}
