/**
 * @OnlyCurrentDoc
 * AI_Generator.gs - Only logic, prompt texts, and playlist settings.
 */

const GENERATOR_CONFIG = {
  MODE: 'TOPIC', 
  ACTION: 'UPDATE_EXISTING',
  UPDATE_METHOD: 'APPEND', 
  
  TOPIC_PROMPT: 'Create a perfect playlist for a long road trip. Mood and atmosphere: Bright, cheerful, inspiring, with a touch of road romance and freedom. This is music that sounds perfect when forests, fields, lakes, and cozy villages drift past the window. It should create a feeling of lightness and inner warmth.',
  
  TARGET_PLAYLIST_ID: 'INSERT_TARGET_PLAYLIST_ID_HERE', 
  NUMBER_OF_TRACKS_TO_REQUEST: 100,
  MAX_PLAYLIST_SIZE: 500, // <== NEW LIMIT FOR THE GENERATOR

  CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS: 30,
  
  // --- NEW SORTING SETTINGS ---
  SMART_SORT_ENABLED: true,  // Enable FlowSort?
  SMART_SORT_PRESET: 'drive' // 'atmospheric', 'drive', 'radio'
};

function generateCustomPlaylist() {
  const lock = LockService.getScriptLock();
  try {
    // Wait up to 30 seconds. If cleanup is running, wait for it to finish.
    lock.waitLock(30000); 
  } catch (e) {
    Logger.log('⚠️ Process locked. Another script is currently modifying this playlist. Try again later.');
    return;
  }

  try {
    const config = GENERATOR_CONFIG;
    Logger.log(`🚀 Starting generator. Mode: ${config.MODE}, Method: ${config.UPDATE_METHOD}`);
    
    // --- NEW LOGIC: Check size before generation ---
    if (config.ACTION === 'UPDATE_EXISTING' && config.UPDATE_METHOD === 'APPEND') {
      const currentTracks = Source.getPlaylistTracks('', config.TARGET_PLAYLIST_ID);
      if (currentTracks.length >= config.MAX_PLAYLIST_SIZE) {
        Logger.log(`🛑 Playlist is already full (currently ${currentTracks.length} tracks, limit: ${config.MAX_PLAYLIST_SIZE}).`);
        Logger.log('Generation canceled until you listen to some songs and cleanup is triggered.');
        return;
      }
      Logger.log(`Playlist has free space (${currentTracks.length} of ${config.MAX_PLAYLIST_SIZE}).`);
    }
    // --------------------------------------------------------

    // 1. Create prompt
    let promptText = createPromptFromTopic_(config.TOPIC_PROMPT);

    // 2. Call AI 
    Logger.log('🧠 Starting track list generation...');
    const aiResult = callGeminiTextAPI(promptText);
    const rawAiTracks = parseAiResponse(aiResult.responseText);
    
    Logger.log(`AI suggested ${rawAiTracks.length} tracks.`);

    // 3. Smart search 
    const foundTracks = executeSmartSearch(rawAiTracks);
    Logger.log(`Finally ready to save: ${foundTracks.length} unique tracks.`);

    if (foundTracks.length === 0) return;
    
    // 4. Save and cover
    saveOrUpdateCustomPlaylist_(foundTracks);
    generateAndApplyCover(config.TARGET_PLAYLIST_ID, foundTracks); 

    // CALL SORTING
    if (config.SMART_SORT_ENABLED) {
      applySmartSort(config.TARGET_PLAYLIST_ID, config.SMART_SORT_PRESET);
    }

    Logger.log('🎉 Generation process completed successfully!');

  } catch (error) {
    Logger.log(`CRITICAL ERROR: ${error.toString()}\nStack: ${error.stack}`);
  } finally {
    // MANDATORY: Release the lock
    lock.releaseLock();
  }
}

/**
 * Saves or updates the target playlist (Updated Description Logic)
 */
function saveOrUpdateCustomPlaylist_(tracks) {
    const config = GENERATOR_CONFIG;
    const dateStr = new Date().toLocaleDateString('en-US');
    let playlistId = config.TARGET_PLAYLIST_ID;
    const targetPlaylistInfo = Playlist.getById(playlistId);

    if (config.UPDATE_METHOD === 'APPEND') {
        const existingTracks = Source.getPlaylistTracks('', playlistId);
        const uniqueNewTracks = Selector.sliceCopy(tracks);
        Filter.removeTracks(uniqueNewTracks, existingTracks);

        if (uniqueNewTracks.length > 0) {
            Logger.log(`Adding ${uniqueNewTracks.length} new tracks...`);
            Playlist.saveWithAppend({ id: playlistId, tracks: uniqueNewTracks });
            
            const desc = targetPlaylistInfo.description || "";
            
            // CLEANUP: Remove all old update tags like [+ 3/25/2026: +47]
            // \s* matches spaces before the bracket, \[\+.*?\] matches the tag itself
            const cleanDesc = desc.replace(/\s*\[\+.*?\]/g, '').trim();
            
            SpotifyRequest.put(`${API_BASE_URL}/playlists/${playlistId}`, {
                description: (`${cleanDesc} [+ ${dateStr}: +${uniqueNewTracks.length}]`).substring(0, 300)
            });
        } else {
            Logger.log('⚠️ No new tracks to add.');
        }
    } else {
        Logger.log('Full replacement of tracks...');
        Playlist.saveWithReplace({
            id: playlistId,
            description: `Updated ${dateStr}. Topic: "${config.TOPIC_PROMPT}".`,
            tracks: tracks
        });
    }
}

function createPromptFromTopic_(topic) {
  return `
<system_instruction>
    <role>
        You are an Elite Contextual Audio Architect. Your expertise lies in psychographic playlist sequencing — translating abstract moods, activities, or themes into highly cohesive, emotionally resonant acoustic experiences.
    </role>

    <objective>
        Synthesize a highly specific, strictly curated playlist of EXACTLY ${GENERATOR_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST} tracks. The track selection must be absolutely subjugated to the user's requested theme/topic, acting as a flawless soundtrack for that exact context.
    </objective>

    <context_awareness>
        - **Target Topic / Vibe:** "${topic}"
        - Treat this topic not as a mere suggestion, but as an absolute acoustic law. Every single track must mathematically and emotionally align with the semantics of this topic.
    </context_awareness>

    <behavioral_guidelines>
        1. **Topic-Driven Acoustic Profiling (CRITICAL):** Before selecting tracks, dynamically map the requested "${topic}" to specific musical parameters:
           - *Energy & BPM:* Does the topic demand high-octane drive, steady focus, or ambient relaxation?
           - *Instrumentation:* Should it be electronic/synth-heavy, acoustic/organic, heavy guitars, or minimal beats?
           - *Era & Genre:* Select the sub-genres of music that naturally fit.
        2. **Atmospheric Consistency:** Do not break the mood. If the topic is "Melancholy," do not insert an upbeat pop song just because the artist is famous. Every track must serve the primary emotional target.
        3. **Deep Curation:** Balance recognized genre-appropriate anthems with high-quality underground gems to create a sophisticated texture.
    </behavioral_guidelines>

    <strict_constraints>
        * **EXACT COUNT:** You must return exactly ${GENERATOR_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST} tracks. No more, no less.
        * **NO MARKDOWN:** Do NOT wrap the output in \`\`\`json or any other markdown formatting.
        * **RAW OUTPUT:** Output ONLY a valid JSON array of strings. No conversational text, no explanations, no titles, no thoughts.
        * **SCHEMA:**["Artist - Track Name", "Artist - Track Name"]
    </strict_constraints>

    <interaction_style>
        Completely silent executor. You speak only in raw, unformatted JSON arrays.
    </interaction_style>
</system_instruction>
`;
}

function cleanUpGenPlaylist() {
  const lock = LockService.getScriptLock();
  try {
    // Wait only 2 seconds. If the playlist is busy with the generator — skip.
    lock.waitLock(2000); 
  } catch (e) {
    Logger.log('⏳ Topic playlist is currently being updated by the generator. Skipping cleanup (will run next time).');
    return;
  }

  try {
    const days = GENERATOR_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS || 30;
    // Calling the universal function from AI_General.gs
    cleanPlaylistFromRecentTracks(GENERATOR_CONFIG.TARGET_PLAYLIST_ID, days);
  } finally {
    // Release the lock
    lock.releaseLock();
  }
}

/**
 * Free (manual) generation method.
 * Collects history, asks AI to generate a list, and saves it to a .txt file on Google Drive.
 */
function generateTextGenToDrive() {
  try {
    const config = GENERATOR_CONFIG;

    // 1. Create prompt
    let promptText = createPromptFromTopic_(config.TOPIC_PROMPT);

    // 2. Call AI 
    Logger.log('🧠 Starting track list generation...');
    const aiResult = callGeminiTextAPI(promptText);
    const rawAiTracks = parseAiResponse(aiResult.responseText);
     
    if (!rawAiTracks || rawAiTracks.length === 0) {
      Logger.log('⚠️ AI did not return any tracks. Possible parsing error.');
      return;
    }
    
    Logger.log(`✅ AI suggested ${rawAiTracks.length} tracks.`);
    
    // 3. Save as a text file in Google Drive ("Goofy Data" folder)
    const fileName = 'AI_Topic_Mix.txt';
    const textContent = rawAiTracks.join('\n'); // Join array of strings with line breaks
    
    Cache.write(fileName, textContent);
    
    Logger.log(`🎉 Done! File "${fileName}" successfully saved in your Google Drive (look in "Goofy Data" folder).`);

  } catch (error) {
    Logger.log(`❌ CRITICAL ERROR: ${error.toString()}`);
  }
}
