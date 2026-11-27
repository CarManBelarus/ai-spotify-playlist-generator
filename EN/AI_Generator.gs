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
    const { systemInstruction, userPrompt } = createPromptFromTopic_(config.TOPIC_PROMPT);

    // 2. Call AI 
    Logger.log('🧠 Starting track list generation...');
    const aiResult = callGeminiTextAPI(userPrompt, { systemInstruction });
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
  const total = GENERATOR_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST;

  const systemInstruction = `## Function
Generate a cohesive thematic playlist of exactly ${total} real tracks available on Spotify, strictly matched to the target topic, activity, mood, and era.

## Acoustic Profiling & Curation Criteria
1. **Topic-Driven Acoustic Profiling:** Align every track to the musical parameters implied by the target topic:
   - *Energy & BPM:* Match the required intensity (high-octane drive, steady focus, or ambient relaxation).
   - *Instrumentation:* Choose fitting textures (electronic/synth-heavy, acoustic/organic, heavy guitars, or minimal beats).
   - *Era & Genre:* Select sub-genres and eras that naturally fit the target vibe.
2. **Atmospheric Consistency:** Maintain unbroken emotional alignment—never insert an upbeat pop track into a "Melancholy" playlist just because the artist is famous.
3. **Deep Curation:** Balance recognized genre-appropriate anthems with high-quality underground gems.

## Strict Constraints
- **Verified Spotify Catalog Only:** Include only real, verifiable tracks with exact Spotify spelling (no self-transliteration). Omit version tags such as 'Live', 'Remastered', or 'Radio Edit'.
- **Zero Duplicates:** Every entry in the ${total}-track list must be unique.
- **Element Format:** Each array item must strictly follow "Artist - Track Name".`;

  const userPrompt = `## Target Topic / Vibe
${topic}

Based on the target topic above, generate an array of exactly ${total} unique, real Spotify tracks formatted as "Artist - Track Name", preserving exact Spotify spelling, clean titles, and unbroken atmospheric consistency.`;

  return { systemInstruction, userPrompt };
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
    const { systemInstruction, userPrompt } = createPromptFromTopic_(config.TOPIC_PROMPT);

    // 2. Call AI 
    Logger.log('🧠 Starting track list generation...');
    const aiResult = callGeminiTextAPI(userPrompt, { systemInstruction });
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
