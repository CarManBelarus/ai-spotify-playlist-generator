/**
 * @OnlyCurrentDoc
 * AI_Playlist.gs - Analyzes saved tracks and generates daily discovery mixes.
 */

const AI_CONFIG = {
  SPOTIFY_PLAYLIST_ID: 'INSERT_YOUR_PLAYLIST_ID_HERE', 
  TRACK_SAMPLE_SIZE_FOR_AI: 500,
  NUMBER_OF_TRACKS_TO_REQUEST: 100, 
  MAX_PLAYLIST_SIZE: 500, 
  PLAYLIST_NAME_TEMPLATE: 'AI Playlist from {date}',
  CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS: 60,
  
  // --- NEW SORTING SETTINGS ---
  SMART_SORT_ENABLED: true,
  SMART_SORT_PRESET: 'atmospheric' // 'atmospheric', 'drive', 'radio'
};

function generateAndCreateSpotifyPlaylist() {
  const lock = LockService.getScriptLock();
  try {
    // Wait up to 30 seconds. If a cleanup is currently running (takes 5-10 secs),
    // the script will wait and then start generation. If locked longer - abort.
    lock.waitLock(30000); 
  } catch (e) {
    Logger.log('⚠️ Process locked. Another script is currently modifying the playlist. Try again later.');
    return;
  }

  try {
    Logger.log('Starting the process of creating an AI playlist...');

    // --- NEW LOGIC: Check size before starting generation ---
    const currentTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
    if (currentTracks.length >= AI_CONFIG.MAX_PLAYLIST_SIZE) {
      Logger.log(`🛑 The playlist is already full (currently ${currentTracks.length} tracks, limit: ${AI_CONFIG.MAX_PLAYLIST_SIZE}).`);
      Logger.log('AI request and search for new tracks canceled until space becomes available.');
      return; 
    }
    Logger.log(`There is free space in the playlist (${currentTracks.length} of ${AI_CONFIG.MAX_PLAYLIST_SIZE}). Continuing...`);
    // ------------------------------------------------------------

    // 1. Get tracks
    const allTracks = Cache.read('SavedTracks.json');
    const randomTracks = Selector.sliceRandom(allTracks, AI_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
    const promptText = createTrackRecommendationPrompt_(JSON.stringify(randomTracks));

    // 2. Call AI from AI_General.gs
    const aiResult = callGeminiTextAPI(promptText);
    const rawAiTracks = parseAiResponse(aiResult.responseText);
    
    if (rawAiTracks.length === 0) return;

    // 3. Bulletproof search from AI_General.gs
    const foundSpotifyTracks = executeSmartSearch(rawAiTracks);
    if (foundSpotifyTracks.length === 0) return;

    // 4. Save
    updatePlaylistIncrementally_(foundSpotifyTracks);

    Logger.log('Process completed successfully.');

  } catch (error) {
    Logger.log(`CRITICAL ERROR: ${error.toString()}`);
  } finally {
    // MANDATORY: Release the lock at the end, even if an error occurred
    lock.releaseLock();
  }
}

function updatePlaylistIncrementally_(foundSpotifyTracks) {
  const existingTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  let newUniqueTracks = Selector.sliceCopy(foundSpotifyTracks);
  Filter.removeTracks(newUniqueTracks, existingTracks);

  if (newUniqueTracks.length > 0) {
    Logger.log(`Adding ${newUniqueTracks.length} new tracks in chunks...`);
    for (let i = 0; i < newUniqueTracks.length; i += 100) {
      Playlist.saveWithAppend({
        id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
        tracks: newUniqueTracks.slice(i, i + 100),
        position: 'begin' 
      });
      Utilities.sleep(1000);
    }
  }

  // Update title and call cover generator from AI_General.gs
  const finalTotal = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID).length;
  const dateStr = new Date().toLocaleDateString('en-US');
  
  SpotifyRequest.put(`${API_BASE_URL}/playlists/${AI_CONFIG.SPOTIFY_PLAYLIST_ID}`, {
      name: AI_CONFIG.PLAYLIST_NAME_TEMPLATE.replace('{date}', dateStr),
      description: `Last updated: ${dateStr}. Total: ${finalTotal} tracks.`
  });

  generateAndApplyCover(AI_CONFIG.SPOTIFY_PLAYLIST_ID, foundSpotifyTracks);

  // Truncation if limit is exceeded (Disabled for now to let manual cleanup work)
  // const currentTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  // if (currentTracks.length > AI_CONFIG.MAX_PLAYLIST_SIZE) {
  //     Playlist.saveWithReplace({
  //         id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
  //         tracks: currentTracks.slice(0, AI_CONFIG.MAX_PLAYLIST_SIZE)
  //     });
  // }

  // CALL SORTING (always at the very end!)
  if (AI_CONFIG.SMART_SORT_ENABLED) {
     applySmartSort(AI_CONFIG.SPOTIFY_PLAYLIST_ID, AI_CONFIG.SMART_SORT_PRESET);
  }
}

function createTrackRecommendationPrompt_(tracksJsonString) {
  const today = new Date();
  const formattedDate = today.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Dynamic track calculation based on the main parameter
  const total = AI_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST;
  const coreCount = Math.round(total * 0.55);
  const pivotCount = Math.round(total * 0.25);
  const localCount = Math.round(total * 0.15);
  const classicCount = total - coreCount - pivotCount - localCount;

return `
<system_instruction>
    <role>
        You are an elite Music Curator and Spotify Data Analyst. Your expertise combines deep knowledge of global and local music history with an algorithmic understanding of the user's "Taste DNA". You don't just create song lists, but authorial musical journeys with flawless developmental logic.
    </role>

    <objective>
        Analyze the user's listening history, determine the current calendar/seasonal context, and generate a perfectly balanced playlist of exactly ${total} tracks formatted strictly as a JSON array.
    </objective>

    <context_awareness>
        - **Current Date:** ${formattedDate}.
        - **Seasonality & Holidays:** Automatically identify the current season and approaching holidays. Integrate the appropriate festive or seasonal mood into some of the tracks (e.g., warm soul/jazz in winter, energetic indie in summer), but maintain overall alignment with the Taste DNA.
        - **Taste Base (DNA):** The following JSON contains the user's listening history. Use this as your only compass to determine genres, eras, and temperament.
          [Input DNA]: ${tracksJsonString}
    </context_awareness>

    <behavioral_guidelines>
        During playlist generation, use the following mixing strategy (proportions must be followed as closely as possible for ${total} tracks):

        1. **Core Matches (~${coreCount} tracks): The Deep Comfort Zone.**
           - Look for lesser-known songs (Deep Cuts, B-sides) of the user's favorite artists. Do not add their main hits.
           - Find new, similar-sounding artists the user doesn't know yet.
        
        2. **Pivots (~${pivotCount} tracks): A Bold Step Sideways.**
           - Expand horizons through adjacent genres or other eras (e.g., if the base is indie rock, suggest French Coldwave or Neo-Psychedelia).
           - Use the "Best Of" principle here: provide only globally recognized benchmarks of the new genre so the user can immediately understand it.
        
        3. **Local Spotlight (~${localCount} tracks): Regional Context.**
           - Music from the user's local or culturally adjacent scene that PERFECTLY matches the main vibe (DNA).
           - This should not look like a random insertion, but a natural continuation of their taste profile.
        
        4. **Genre Classics (~${classicCount} tracks): Genre Anthems.**
           - Powerful "anchors" of the playlist. Absolute anthems of the genres that dominate the user's DNA.
    </behavioral_guidelines>

    <strict_constraints>
        * **NO REPEATS:** No track from [Input DNA] should appear in the final playlist.
        * **CLEAN TITLES:** Do not use tags like 'Live', 'Remastered', 'Radio Edit' in track titles.
        * **SPOTIFY SPELLING:** Band names must be written EXACTLY AS IN SPOTIFY. Do not make your own transliteration. 
        * **Total Size:** The final playlist must consist of exactly ${total} tracks.
    </strict_constraints>

    <output_format>
        OUTPUT ONLY VALID JSON. 
        Do not add any introductory words, explanations, or greetings. 
        The format must be strictly an array of strings: ["Artist - Track Name"].
        
        Example of expected output:[
          "Depeche Mode - Enjoy the Silence",
          "Mariya Takeuchi - Plastic Love",
          "Nürnberg - Biessenhofen"
        ]
    </output_format>
</system_instruction>
`;
}

function cleanUpPlaylist() {
  const lock = LockService.getScriptLock();
  try {
    // If generation is running (takes 3-5 minutes), cleanup shouldn't wait.
    // It waits for only 2 seconds, and if the playlist is busy, it just skips this run.
    lock.waitLock(2000); 
  } catch (e) {
    Logger.log('⏳ Playlist is currently being updated by the generator. Skipping cleanup (will run automatically on next trigger).');
    return;
  }

  try {
    const days = AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS || 60;
    // Function is called from AI_General.gs module
    cleanPlaylistFromRecentTracks(AI_CONFIG.SPOTIFY_PLAYLIST_ID, days);
  } finally {
    // Release the lock
    lock.releaseLock();
  }
}

/**
 * Free (manual) generation method.
 * Collects history, asks AI to generate a list, and saves it to a .txt file on Google Drive.
 */
function generateTextMixToDrive() {
  try {
    Logger.log('Starting generation of the text playlist...');
    
    // 1. Read taste base (Likes)
    const allTracks = Cache.read('SavedTracks.json');
    if (!allTracks || allTracks.length === 0) {
      Logger.log('⚠️ SavedTracks.json is empty or not found.');
      return;
    }
    
    // 2. Take random tracks for analysis
    const randomTracks = Selector.sliceRandom(allTracks, 500);
    const promptText = createTrackRecommendationPrompt_(JSON.stringify(randomTracks));
    
    // 3. Call Gemini
    Logger.log('🧠 Requesting AI...');
    const aiResult = callGeminiTextAPI(promptText);
    const rawAiTracks = parseAiResponse(aiResult.responseText);
    
    if (!rawAiTracks || rawAiTracks.length === 0) {
      Logger.log('⚠️ AI did not return any tracks. Possible parsing error.');
      return;
    }
    
    Logger.log(`✅ AI suggested ${rawAiTracks.length} tracks.`);
    
    // 4. Save as a text file in Google Drive ("Goofy Data" folder)
    const fileName = 'AI_Daily_Mix.txt';
    const textContent = rawAiTracks.join('\n'); // Join array of strings with line breaks
    
    Cache.write(fileName, textContent);
    
    Logger.log(`🎉 Done! File "${fileName}" successfully saved in your Google Drive (look in "Goofy Data" folder).`);

  } catch (error) {
    Logger.log(`❌ CRITICAL ERROR: ${error.toString()}`);
  }
}
