/**
 * @OnlyCurrentDoc
 * Universal AI Playlist Generator.
 * VERSION: "Golden Release" (Multi-Model Gemini + Safe Placeholders)
 * 
 * This script allows you to generate new playlists "from scratch" based on a text topic
 * or based on an existing source playlist (Sequel/Discovery mode).
 */

// ===============================================================
//                           CONFIGURATION
// ===============================================================

const GENERATOR_CONFIG = {
  // === MAIN MODE SETTINGS ===

  // Mode of operation:
  // 'TOPIC'    - Create a playlist based on a text description (see TOPIC_PROMPT).
  // 'PLAYLIST' - Create a playlist based on the analysis of another playlist (see SOURCE_PLAYLIST_ID).
  MODE: 'TOPIC', 

  // Action:
  // 'CREATE_NEW'      - Create a completely new playlist.
  // 'UPDATE_EXISTING' - Overwrite an existing playlist (see TARGET_PLAYLIST_ID).
  ACTION: 'CREATE_NEW', 

  // === SETTINGS FOR 'TOPIC' MODE ===
  // Describe the mood, genre, or occasion for your playlist.
  TOPIC_PROMPT: 'Multi-genre road trip playlist, upbeat and atmospheric',
  
  // === SETTINGS FOR 'PLAYLIST' MODE ===
  SOURCE_PLAYLIST_ID: 'INSERT_SOURCE_PLAYLIST_ID_HERE', // Template playlist ID
  TRACK_SAMPLE_SIZE_FOR_AI: 400, // Number of tracks to analyze

  // === OUTPUT SETTINGS ===
  // ID of the playlist to overwrite (only for UPDATE_EXISTING)
  TARGET_PLAYLIST_ID: 'INSERT_TARGET_PLAYLIST_ID_HERE',

  // Naming templates for new playlists
  NEW_PLAYLIST_NAME_FOR_TOPIC: 'AI Playlist: {topic}',
  NEW_PLAYLIST_NAME_FOR_PLAYLIST: 'AI Recommendations: {source_name}',

  // === AI SETTINGS (MULTI-MODEL FALLBACK) ===
  // Priority list. If the first fails (503), the next one takes over.
  GEMINI_MODELS_PRIORITY: [
    'gemini-2.5-pro',          // 1. Best Quality
    'gemini-flash-latest',     // 2. Best Speed
    'gemini-flash-lite-latest' // 3. Best Efficiency
  ],

  GENERATE_COVER: true, // Generate AI cover art?
  NUMBER_OF_TRACKS_TO_REQUEST: 200 // Target number of tracks
};

// ===============================================================
//                MAIN GENERATION FUNCTION
// ===============================================================

function generateCustomPlaylist() {
  try {
    const config = GENERATOR_CONFIG;
    Logger.log(`🚀 Starting Generator. Mode: ${config.MODE}, Action: ${config.ACTION}`);
    
    const geminiApiKey = getGeminiApiKey_();
    let promptText = '';
    let sourcePlaylistName = ''; 

    // 1. Prepare Prompt
    if (config.MODE === 'PLAYLIST') {
      const sourcePlaylistInfo = Playlist.getById(config.SOURCE_PLAYLIST_ID);
      if (!sourcePlaylistInfo) throw new Error(`Source playlist not found.`);
      
      sourcePlaylistName = sourcePlaylistInfo.name;
      const sourceTracks = Source.getPlaylistTracks('', config.SOURCE_PLAYLIST_ID);
      if (sourceTracks.length === 0) throw new Error('Source playlist is empty.');

      const tracksJson = prepareEnrichedSample_(sourceTracks);
      promptText = createPromptFromPlaylist_(sourcePlaylistName, tracksJson);

    } else if (config.MODE === 'TOPIC') {
      promptText = createPromptFromTopic_(config.TOPIC_PROMPT);
    } else {
      throw new Error(`Invalid MODE: ${config.MODE}`);
    }

    // 2. Call AI with Fallback Loop
    let aiResponse = null;
    let usedModel = '';

    Logger.log('🧠 Generating track list...');

    for (const modelName of config.GEMINI_MODELS_PRIORITY) {
      Logger.log(`🔄 Attempting model: "${modelName}"...`);
      aiResponse = callGeminiApi_(geminiApiKey, modelName, promptText);
      
      if (aiResponse) {
        Logger.log(`✅ Model "${modelName}" responded.`);
        usedModel = modelName;
        break; 
      } else {
        Logger.log(`⚠️ Model "${modelName}" failed. Switching to next...`);
        Utilities.sleep(1000);
      }
    }

    if (!aiResponse) throw new Error('❌ All Gemini models are unavailable.');

    // 3. Search Tracks
    const tracksToSearch = parseAiResponse_(aiResponse).map(track => normalizeTrackQuery_(track));
    Logger.log(`AI (${usedModel}) suggested ${tracksToSearch.length} tracks. Searching Spotify...`);
    
    const foundTracks = Search.multisearchTracks(tracksToSearch);
    Filter.dedupTracks(foundTracks);
    Logger.log(`Found ${foundTracks.length} unique tracks.`);

    if (foundTracks.length === 0) {
        Logger.log('No tracks found. Stopping.');
        return;
    }
    
    // 4. Save Result
    saveOrUpdateCustomPlaylist_(foundTracks, sourcePlaylistName);
    Logger.log('🎉 Generator completed successfully!');

  } catch (error) {
    Logger.log(`CRITICAL ERROR: ${error.toString()}`);
  }
}

// ===============================================================
//                SAVING & UPDATING LOGIC
// ===============================================================

function saveOrUpdateCustomPlaylist_(tracks, sourcePlaylistName = '') {
    const config = GENERATOR_CONFIG;
    const dateStr = new Date().toLocaleDateString('en-US');
    let playlistId, playlistName, playlistDescription;

    if (config.ACTION === 'CREATE_NEW') {
        Logger.log('Creating new playlist...');

        if (config.MODE === 'PLAYLIST') {
            playlistName = config.NEW_PLAYLIST_NAME_FOR_PLAYLIST.replace('{source_name}', sourcePlaylistName);
            playlistDescription = `Generated on ${dateStr} based on "${sourcePlaylistName}".`;
        } else { 
            // Generate smart short title
            let shortTopic = getTopicSummary_(config.TOPIC_PROMPT);
            if (!shortTopic) {
                shortTopic = config.TOPIC_PROMPT.length > 50 
                    ? config.TOPIC_PROMPT.substring(0, 47) + '...' 
                    : config.TOPIC_PROMPT;
            }
            playlistName = config.NEW_PLAYLIST_NAME_FOR_TOPIC.replace('{topic}', shortTopic);
            playlistDescription = `Generated on ${dateStr}. Topic: "${config.TOPIC_PROMPT}".`;
        }
        
        // Logic to find the ID of the newly created playlist
        const initialPlaylists = Playlist.getPlaylistArray();
        const initialPlaylistIds = new Set(initialPlaylists.map(p => p.id));

        Playlist.saveWithReplace({
            name: playlistName,
            description: playlistDescription,
            isPublic: false,
            tracks: tracks
        });

        Utilities.sleep(3000); // Wait for API propagation
        const finalPlaylists = Playlist.getPlaylistArray();
        const newPlaylist = finalPlaylists.find(p => !initialPlaylistIds.has(p.id));

        if (newPlaylist) {
            playlistId = newPlaylist.id;
            Logger.log(`✅ Created playlist ID: ${playlistId}`);
        } else {
            // Fallback: search by name
            const foundByName = Playlist.getByName(playlistName);
            if (foundByName) {
                playlistId = foundByName.id;
                Logger.log(`✅ Playlist found by name: ${playlistId}`);
            } else {
                Logger.log('⚠️ Could not determine new playlist ID. Cover art skipped.');
            }
        }

    } else if (config.ACTION === 'UPDATE_EXISTING') {
        Logger.log(`Updating playlist ID: ${config.TARGET_PLAYLIST_ID}`);
        if (!config.TARGET_PLAYLIST_ID || config.TARGET_PLAYLIST_ID.includes('INSERT')) {
             throw new Error('Target Playlist ID is missing.');
        }
        
        playlistId = config.TARGET_PLAYLIST_ID;
        const targetInfo = Playlist.getById(playlistId);
        playlistName = targetInfo ? targetInfo.name : 'Playlist';

        playlistDescription = config.MODE === 'PLAYLIST' 
            ? `Updated ${dateStr} based on "${sourcePlaylistName}".`
            : `Updated ${dateStr}. Topic: "${config.TOPIC_PROMPT}".`;
        
        Playlist.saveWithReplace({
            id: playlistId,
            description: playlistDescription,
            tracks: tracks
        });
        Logger.log(`✅ Playlist updated.`);
    }

    // Cover Generation
    if (config.GENERATE_COVER && playlistId && typeof generatePlaylistCover_ === 'function') {
        Logger.log('Generating cover art...');
        // Use local helper to avoid dependency on global config
        const coverImageBase64 = generateCoverFromTracksList_(tracks); 
        
        if (coverImageBase64) {
            try {
                SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${playlistId}/images`, coverImageBase64);
                Logger.log('✅ Cover uploaded.');
            } catch (e) { Logger.log(`⚠️ Upload error: ${e}`); }
        }
    }
}

// ===============================================================
//                PROMPTS & DATA PREPARATION
// ===============================================================

function createPromptFromTopic_(topic) {
  return `
[Role]: Expert Music Curator.
[Task]: Create a playlist of ${GENERATOR_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST} tracks based on the topic: "${topic}".
[Rules]:
- Mix of hits and hidden gems.
- Exclude: Russian language songs.
- Priority: Vibe and quality.
[Format]: EXCLUSIVELY a JSON array of strings "Artist - Track".
`;
}

function createPromptFromPlaylist_(playlistName, tracksJsonString) {
  return `
[Role]: AI Music Curator.
[Input]: Playlist "${playlistName}" (JSON).
\`\`\`${tracksJsonString}\`\`\`
[Task]: Create a sequel/extension (${GENERATOR_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST} tracks).
[Rules]:
- 70% similar style, 30% adjecent discovery.
- Exclude: Russian language songs.
- Exclude: Duplicates from input.
[Format]: EXCLUSIVELY a JSON array of strings "Artist - Track".
`;
}

function prepareEnrichedSample_(sourceTracks) {
  Logger.log(`Sampling ${GENERATOR_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI} tracks...`);
  const randomSample = Selector.sliceRandom(sourceTracks, GENERATOR_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
  const enrichedSample = randomSample.map(track => {
    if (!track?.name || !track.artists?.[0]?.name) return null;
    return `${track.artists[0].name} - ${track.name}`;
  }).filter(item => item !== null);
  return JSON.stringify(enrichedSample);
}

function getTopicSummary_(topicPrompt) {
  if (topicPrompt.length <= 25) return topicPrompt;

  Logger.log('Generating short title...');
  const summaryPrompt = `
Shorten this playlist title to 2-3 words (English). 
Topic: "${topicPrompt}". 
Output ONLY the title. No quotes.
`;
  
  const apiKey = getGeminiApiKey_();
  for (const model of GENERATOR_CONFIG.GEMINI_MODELS_PRIORITY) {
    try {
       const summary = callGeminiApi_(apiKey, model, summaryPrompt);
       if (summary && summary.trim().length > 0) {
         return summary.trim().replace(/["«»]/g, '');
       }
    } catch (e) {}
  }
  return null;
}

/**
 * Local cover generator helper.
 * It uses the logic from the main script but accepts a direct track list.
 */
function generateCoverFromTracksList_(tracks) {
    if (typeof createImagePromptFromTracks_ !== 'function' || typeof callHuggingFaceApiWithModel_ !== 'function') {
        Logger.log('Required functions from AI_playlist.gs are missing.');
        return null;
    }

    const imagePrompt = createImagePromptFromTracks_(tracks);
    if (!imagePrompt) return null;

    // Use Golden List models
    const models = (typeof AI_CONFIG !== 'undefined' && AI_CONFIG.IMAGE_GENERATION) 
        ? [
            AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.FLUX_DEV,
            AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.FLUX_SCHNELL,
            AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.SD3_MEDIUM,
            AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.SDXL_BASE
          ]
        : ['black-forest-labs/FLUX.1-schnell', 'stabilityai/stable-diffusion-xl-base-1.0'];

    for (const modelId of models) {
        if (!modelId) continue;
        Logger.log(`🎨 Generating cover via: "${modelId}"...`);
        const imageBase64 = callHuggingFaceApiWithModel_(imagePrompt, modelId);
        if (imageBase64) return imageBase64;
    }
    return null;
}
