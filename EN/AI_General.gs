/**
 * @OnlyCurrentDoc
 * AI_General.gs - Central repository for global AI/Search settings and shared functions.
 */

// =========================================================================
// 1. GLOBAL AI CONFIGURATION & HOST HELPER
// =========================================================================
const GLOBAL_AI_CONFIG = {
  // Provider selection: 'VERTEX_AI' or 'AI_STUDIO'
  PROVIDER: 'VERTEX_AI', 
  
  VERTEX_AI: {
    PROJECT_ID: PropertiesService.getScriptProperties().getProperty('GCP_PROJECT_ID'),
    LOCATION: 'global' // 'global' or regional: 'us-central1', 'europe-west1'
  },

  TEXT: {
    MODELS_PRIORITY: [
      'gemini-3.1-pro-preview',
      'gemini-3.6-flash',    
      'gemini-3.1-flash-lite-preview'
    ]
  },

  IMAGE: {
    ENABLED: true,
    GEMINI_MODELS_PRIORITY: [
      'gemini-3.1-flash-image',       
      'gemini-3-pro-image',           
      'gemini-3.1-flash-lite-image' 
    ], 
    POLLINATIONS_MODEL: 'flux' 
  }  
};

function getAuthToken_() {
  return ScriptApp.getOAuthToken();
}

function getGeminiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key && GLOBAL_AI_CONFIG.PROVIDER === 'AI_STUDIO') {
    throw new Error("API key 'GEMINI_API_KEY' not found in Script Properties.");
  }
  return key;
}

/**
 * Resolves 404 endpoint routing errors by building the correct host URL for Vertex AI.
 */
function getVertexHost_() {
  const loc = GLOBAL_AI_CONFIG.VERTEX_AI.LOCATION;
  if (!loc || loc === 'global') {
    return 'https://aiplatform.googleapis.com';
  }
  return `https://${loc}-aiplatform.googleapis.com`;
}

// =========================================================================
// 2. TEXT AI ENGINE (GEMINI)
// =========================================================================

function callGeminiTextAPI(promptText) {
  let aiResponse = null;
  let usedModel = '';

  for (const modelName of GLOBAL_AI_CONFIG.TEXT.MODELS_PRIORITY) {
    Logger.log(`🔄 Attempting to call model: "${modelName}" via ${GLOBAL_AI_CONFIG.PROVIDER}...`);
    
    let url, options;

    if (GLOBAL_AI_CONFIG.PROVIDER === 'VERTEX_AI') {
      const host = getVertexHost_();
      const loc = GLOBAL_AI_CONFIG.VERTEX_AI.LOCATION || 'global';
      const projectId = GLOBAL_AI_CONFIG.VERTEX_AI.PROJECT_ID;
      
      url = `${host}/v1/projects/${projectId}/locations/${loc}/publishers/google/models/${modelName}:generateContent`;
      
      const payload = {
        "contents": [{
          "role": "user",
          "parts": [{ "text": promptText }]
        }],
        "generationConfig": {
          "temperature": 1.0,
          "responseMimeType": "application/json"
        }
      };

      options = { 
        'method': 'post', 
        'contentType': 'application/json', 
        'headers': { 'Authorization': 'Bearer ' + getAuthToken_() }, 
        'payload': JSON.stringify(payload), 
        'muteHttpExceptions': true 
      };
    } else {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${getGeminiKey_()}`;
      
      const studioPayload = {
         "contents": [{"parts":[{"text": promptText}]}],
         "generationConfig": { 
           "temperature": 1.1, 
           "responseMimeType": "application/json" 
         }
      };

      options = { 
        'method': 'post', 
        'contentType': 'application/json', 
        'payload': JSON.stringify(studioPayload), 
        'muteHttpExceptions': true 
      };
    }

    try {
      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const content = response.getContentText();
      
      if (responseCode === 200) {
        const json = JSON.parse(content);
        if (json.candidates && json.candidates[0].content && json.candidates[0].content.parts) {
           aiResponse = json.candidates[0].content.parts[0].text;
           usedModel = modelName;
           Logger.log(`✅ Model "${modelName}" successfully generated response.`);
           break;
        }
      } else {
        Logger.log(`⚠️ Model "${modelName}" is unavailable (Code: ${responseCode}). API response: ${content.substring(0, 300)}`);
        Utilities.sleep(1000);
      }
    } catch (e) {
      Logger.log(`⚠️ Request execution error for model "${modelName}": ${e.toString()}`);
    }
  }

  if (!aiResponse) throw new Error('❌ All text models are unavailable.');
  return { responseText: aiResponse, model: usedModel };
}

function parseAiResponse(rawResponse) {
  let cleanedJson = rawResponse.replace(/^[\s\S]*?\[/, '[').replace(/\][\s\S]*$/, ']');
  try {
    let tracks = JSON.parse(cleanedJson);
    if (!Array.isArray(tracks)) throw new Error("Response is not an array");
    return tracks.filter(item => typeof item === 'string' && item.trim().length > 0);
  } catch (e) {
    Logger.log(`❌ Response parsing error: ${e.message}\nRaw response: ${rawResponse}`);
    return [];
  }
}

// =========================================================================
// 3. IMAGE ENGINE (COVER ART)
// =========================================================================

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
    Logger.log('⏳ Uploading cover art to Spotify...');
    try {
      SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${playlistId}/images`, coverBase64);
      Logger.log('✅ Cover art upload request sent successfully.');
    } catch (e) {
      Logger.log(`❌ Cover art upload error: ${e.toString()}`);
    }
  }
}

function buildImagePrompt_(tracks) {
  const trackSample = Selector.sliceRandom(tracks, 50).map(t => `${t.artists[0].name} - ${t.name}`).join('\n');
  const exampleStyles = "Surrealism, Vintage 70s Sci-Fi Illustration, Minimalist Graphic Design, Abstract Expressionism, Cinematic 35mm Photography, Cyberpunk, Japanese Woodblock print, Glitch Art, Classic Oil Painting, Dark Fantasy, Pop Art";
  const examplePalettes = "Neon and High Contrast, Muted Autumn Earth Tones, Cold Melancholic Blues, Monochrome with one piercing accent, Pastel watercolors, Dark and Moody, Psychedelic Acid Colors";
  const instruction  = `<system_instruction>
    <role>
        You are a Visionary Art Director and a Music Sociologist. You translate the deep semantic meaning, cultural context, and emotional weight of music into breathtaking visual concepts.
    </role>
    <objective>
        1. Analyze the provided 50-track playlist. Extract the overarching lyrical themes, stories, and cultural context.
        2. Determine the absolute best visual style and color palette to amplify this specific mood. You can use the provided examples as inspiration, OR choose any other artistic medium that fits better.
        3. Write a highly detailed text-to-image prompt for an album cover based on this semantic metaphor.
    </objective>
    <context_awareness>
        Treat the following tracklist not as text, but as an emotional landscape. What are these songs ABOUT?
        [Input Tracks]:
        ${trackSample}

        [Examples of Visual Styles]:
        ${exampleStyles}

        [Examples of Color Palettes]:
        ${examplePalettes}
    </context_awareness>
    <behavioral_guidelines>
        1. **Semantic Translation (CRITICAL):** Look at the MEANING of the tracks. Create a surreal or abstract scene that represents the shared storyline or emotion.
        2. **Absolute Creative Freedom:** You are NOT limited to the provided examples. Choose whatever makes the most artistic sense for this specific genre and mood.
    </behavioral_guidelines>
    <strict_constraints>
        * **NO ROCK PUNS (CRITICAL):** If the music genre is "Rock", YOU ARE STRICTLY FORBIDDEN from drawing literal rocks, stones, boulders, mountains, or monoliths.
        * **NO LITERAL MUSIC ELEMENTS:** NEVER include musical instruments, notes, vinyl records, cassettes, or audio waves.
        * **NO TEXT/WORDS:** The image must contain absolutely NO words, NO artist names, NO titles, and NO typography.
        * **FORMAT:** Output EXACTLY ONE paragraph under 140 words. Written entirely in English.
        * **RAW OUTPUT ONLY:** Output ONLY the raw image prompt. No JSON, no formatting tags.
    </strict_constraints>
</system_instruction>`;
  
  try {
    const result = callGeminiTextAPI(instruction);
    let prompt = result.responseText.replace(/```json|```/g, '').trim();
    try {
      const parsed = JSON.parse(prompt);
      if (parsed.prompt) prompt = parsed.prompt;
      else if (Array.isArray(parsed) && parsed.length > 0) prompt = parsed[0];
    } catch(e) {} 
    
    Logger.log(`✅ Image prompt created: "${prompt.substring(0, 150)}..."`);
    return prompt;
  } catch (e) {
    Logger.log(`⚠️ Failed to create image prompt: ${e.toString()}`);
    return null;
  }
}

function callGeminiImageGen_(prompt) {
  for (const modelName of GLOBAL_AI_CONFIG.IMAGE.GEMINI_MODELS_PRIORITY) {
    Logger.log(`🎨 Attempting image generation via ${GLOBAL_AI_CONFIG.PROVIDER} (${modelName})...`);
    
    let url, options;
    if (GLOBAL_AI_CONFIG.PROVIDER === 'VERTEX_AI') {
      const host = getVertexHost_();
      const loc = GLOBAL_AI_CONFIG.VERTEX_AI.LOCATION || 'global';
      const projectId = GLOBAL_AI_CONFIG.VERTEX_AI.PROJECT_ID;
      
      url = `${host}/v1/projects/${projectId}/locations/${loc}/publishers/google/models/${modelName}:generateContent`;
      
      const payload = {
        "contents": [{ "role": "user", "parts": [{ "text": prompt }] }],
        "generationConfig": {
          "responseModalities": ["IMAGE"],
          "imageConfig": { "aspectRatio": "1:1", "imageSize": "1K" }
        }
      };
      
      options = { 
        'method': 'post', 
        'contentType': 'application/json', 
        'headers': { 'Authorization': 'Bearer ' + getAuthToken_() },
        'payload': JSON.stringify(payload), 
        'muteHttpExceptions': true 
      };
    } else {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${getGeminiKey_()}`;
      const payload = {
        "contents": [{ "parts":[{ "text": prompt }] }],
        "generationConfig": {
          "responseModalities": ["IMAGE"],
          "imageConfig": { "aspectRatio": "1:1", "imageSize": "1K" }
        }
      };
      options = { 
        'method': 'post', 
        'contentType': 'application/json', 
        'payload': JSON.stringify(payload), 
        'muteHttpExceptions': true 
      };
    }

    try {
      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();
      
      if (responseCode === 200) {
        const json = JSON.parse(responseText);
        let rawBase64 = null;

        const parts = json.candidates?.[0]?.content?.parts;
        if (parts) {
          const imagePart = parts.find(p => p.inlineData && p.inlineData.data);
          if (imagePart) rawBase64 = imagePart.inlineData.data;
        }

        if (rawBase64) {
          let blob = Utilities.newBlob(Utilities.base64Decode(rawBase64), 'image/png').getAs('image/jpeg');
          let base64Payload = Utilities.base64Encode(blob.getBytes());
          let payloadSizeKB = Math.round(base64Payload.length / 1024);
          
          Logger.log(`✅ Image generated. Size: ${payloadSizeKB} KB (Spotify Limit: 250 KB)`);
          
          if (payloadSizeKB > 245) {
              Logger.log(`⚠️ Payload too large. Initiating Google Drive Compression Pipeline...`);
              const compressedBlob = compressBlobViaDrive_(blob);
              if (compressedBlob) {
                  const compressedBase64 = Utilities.base64Encode(compressedBlob.getBytes());
                  const newSizeKB = Math.round(compressedBase64.length / 1024);
                  Logger.log(`✅ Compression successful. New size: ${newSizeKB} KB`);
                  if (newSizeKB > 245) {
                      Logger.log('🛑 Image remains too large after compression. Rejected.');
                      continue;
                  }
                  return compressedBase64;
              } else {
                  Logger.log('❌ Failed to compress image. Proceeding to next model.');
                  continue;
              }
          }
          return base64Payload;
        }
      } else {
        Logger.log(`🛑 API ERROR (Code ${responseCode}): ${responseText.substring(0, 300)}`);
        Utilities.sleep(1000);
      }
    } catch (e) {
      Logger.log(`❌ Critical error during image generation: ${e.toString()}`);
    }
  }
  return null; 
}

function compressBlobViaDrive_(originalBlob) {
  let tempFile = null;
  try {
    tempFile = DriveApp.createFile(originalBlob.setName(`goofy_temp_cover_${Date.now()}.jpg`));
    tempFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const thumbnailUrl = `https://drive.google.com/thumbnail?id=${tempFile.getId()}&sz=w512-h512-c`;
    const response = UrlFetchApp.fetch(thumbnailUrl, { muteHttpExceptions: true });
    
    if (response.getResponseCode() === 200) {
      return response.getBlob().getAs('image/jpeg');
    }
  } catch (e) {
    Logger.log(`❌ Compression error: ${e.message}`);
  } finally {
    if (tempFile) {
      try { tempFile.setTrashed(true); } catch(e) {}
    }
  }
  return null;
}

function callPollinationsImageGen_(prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&model=${GLOBAL_AI_CONFIG.IMAGE.POLLINATIONS_MODEL}&seed=${Math.floor(Math.random() * 1000000)}&nologo=true`;
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      const base64Payload = Utilities.base64Encode(response.getBlob().getBytes());
      if (Math.round(base64Payload.length / 1024) <= 245) return base64Payload;
    }
  } catch (e) {}
  return null;
}

// =========================================================================
// 4. BULLETPROOF SPOTIFY SEARCH
// =========================================================================

function executeSmartSearch(rawAiTracks) {
  if (!rawAiTracks || rawAiTracks.length === 0) return [];
  let allFoundTracks = [], notFoundQueries = [];

  Logger.log('\n--- LEVEL 1: Search by original query ---');
  let stage1Results = fetchSpotifyTracksCustom_(rawAiTracks);
  let stage2Queries = [], stage2Originals = [];

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
    let stage3Originals = [], stage3Queries = [];

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
          Logger.log(`✅ [Lvl 3] Found: "${stage3Originals[i]}" -> ${match.artists[0].name} - ${match.name}`);
        } else {
          notFoundQueries.push(stage3Originals[i]);
        }
      }
    }
  }

  const uniqueTracks = [];
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
    return [];
  });
}

function findBestMatchCustom_(query, tracks, originalQuery = null, isTitleOnly = false) {
  if (!tracks || tracks.length === 0) return null;
  let bestTrack = null;
  let bestScore = 0;
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

    let rawTrackName = track.name.toLowerCase();
    let rawQuery = baseQuery.toLowerCase();
    if (!rawQuery.includes("cover") && !rawQuery.includes("karaoke") && !rawQuery.includes("tribute")) {
        if (rawTrackName.includes("karaoke") || rawTrackName.includes("tribute") || 
            track.artists[0].name.toLowerCase().includes("karaoke") || 
            track.artists[0].name.toLowerCase().includes("tribute")) {
            continue; 
        }
    }

    let score = 0;
    if (qArtist && qTitle) {
        let artistScore = compareStringsCustom_(qArtist, tArtist);
        let titleScore = compareStringsCustom_(qTitle, tTitle);
        if (artistScore < 0.4 && !tArtist.includes(qArtist) && !qArtist.includes(tArtist)) continue; 
        if (titleScore < 0.4 && !tTitle.includes(qTitle) && !qTitle.includes(tTitle)) continue; 
        score = (artistScore * 0.45) + (titleScore * 0.55);
    } else {
        score = compareStringsCustom_(qNormFull, tNormFull);
    }

    if (isTitleOnly && originalQuery) {
      if (qArtist && !tArtist.includes(qArtist) && !qArtist.includes(tArtist)) score -= 0.5; 
    }

    if (score > bestScore) {
      bestScore = score;
      bestTrack = track;
    }
  }
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
  const map = { 'а':'a','б':'b','в':'v','г':'h','д':'d','е':'je','ё':'jo','ж':'zh','з':'z','і':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ў':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ы':'y','ь':'','э':'e','ю':'ju','я':'ja','ґ':'g' };
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

function cleanPlaylistFromRecentTracks(playlistId, days) {
  if (!playlistId) {
    Logger.log('❌ Error: Playlist ID is not specified.');
    return;
  }
  Logger.log(`🧹 Starting playlist cleanup (ID: ${playlistId}). Analyzing last ${days} days...`);
  try {
    const currentTracks = Source.getPlaylistTracks('', playlistId);
    if (!currentTracks || currentTracks.length === 0) return;
    
    let recentTracks = RecentTracks.get(); 
    if (!recentTracks || recentTracks.length === 0) return;
    
    Filter.rangeDateRel(recentTracks, days, 0);
    const recentIds = new Set(recentTracks.map(t => t.id));
    
    const tracksToRemove = currentTracks.filter(t => recentIds.has(t.id));
    if (tracksToRemove.length > 0) {
      const urisToDelete = tracksToRemove.map(t => ({ uri: t.uri || `spotify:track:${t.id}` }));
      for (let i = 0; i < urisToDelete.length; i += 100) {
          const chunk = urisToDelete.slice(i, i + 100);
          SpotifyRequest.deleteRequest(`${API_BASE_URL}/playlists/${playlistId}/tracks`, { tracks: chunk });
      }
      Logger.log(`✅ Targeted cleanup complete. Removed: ${tracksToRemove.length} tracks.`);
    }
  } catch (e) {
    Logger.log(`❌ Cleanup error: ${e.toString()}`);
  }
}

// =========================================================================
// 6. FLOWSORT INTEGRATION (SMART SEQUENCING)
// =========================================================================

function applySmartSort(playlistId, preset = 'atmospheric') {
  if (!playlistId) return;
  Logger.log(`🌊 Starting FlowSort smart sorting for playlist (ID: ${playlistId})...`);
  try {
    if (typeof FlowSort === 'undefined' || !FlowSort.sortBalancedWave) return;
    const tracks = Source.getPlaylistTracks('', playlistId);
    if (!tracks || tracks.length < 4) return;

    let weights = {};
    if (preset === 'atmospheric') weights = { tempo: 0.40, harmony: 0.55, energy: 0.05, valence: 0.0 };
    else if (preset === 'drive') weights = { tempo: 0.80, harmony: 0.15, energy: 0.05, valence: 0.0 };
    else weights = { tempo: 0.50, harmony: 0.30, energy: 0.15, valence: 0.05 };

    const sortedTracks = FlowSort.sortBalancedWave(tracks, { weights: weights });
    Playlist.saveWithReplace({ id: playlistId, tracks: sortedTracks });
  } catch (e) {
    Logger.log(`❌ Error during sorting: ${e.toString()}`);
  }
}
