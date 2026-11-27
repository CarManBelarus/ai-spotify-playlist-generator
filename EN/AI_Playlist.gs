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

/**
 * Compacts raw track objects from SavedTracks.json into "Artist - Track Name" strings
 * to save input tokens and speed up API responses.
 */
function compactTracksForAi_(tracks) {
  return tracks
    .map(item => {
      if (typeof item === 'string') return item;
      const t = item && item.track ? item.track : item;
      const artist = t?.artists?.[0]?.name || t?.artist || '';
      const title = t?.name || t?.title || '';
      return artist && title ? `${artist} - ${title}` : null;
    })
    .filter(Boolean);
}

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

    // 1. Get and compact tracks
    const allTracks = Cache.read('SavedTracks.json');
    const randomTracks = Selector.sliceRandom(allTracks, AI_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
    const compactTracks = compactTracksForAi_(randomTracks);
    const { systemInstruction, userPrompt } = createTrackRecommendationPrompt_(JSON.stringify(compactTracks));

    // 2. Call AI from AI_General.gs
    const aiResult = callGeminiTextAPI(userPrompt, { systemInstruction });
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

  const systemInstruction = `## Function
Generate a personalized discovery playlist of exactly ${total} real tracks available on Spotify based on the user's listening history (Input DNA) and current seasonal/calendar context.

## Mixing Strategy (exact proportions for ${total} tracks)
Distribute all four categories evenly across the playlist:
1. **Core Matches (~${coreCount} tracks):** Lesser-known songs (Deep Cuts, B-sides—not main hits) by the user's favorite artists from Input DNA, plus new similar-sounding artists not yet present in the sample.
2. **Pivots (~${pivotCount} tracks):** Adjacent genres or other eras (e.g., if the base is indie rock, suggest French Coldwave or Neo-Psychedelia) using the "Best Of" principle—globally recognized benchmarks of the new genre.
3. **Local Spotlight (~${localCount} tracks):** Music from the user's local or culturally adjacent scene that naturally fits the dominant vibe of their Input DNA.
4. **Genre Classics (~${classicCount} tracks):** Defining genre anthems that anchor the dominant styles in the user's Input DNA.

## Seasonality & Calendar Context
Identify the current season and approaching holidays from the provided Current Date and subtly weave an appropriate seasonal mood into part of the selection (e.g., warm soul/jazz in winter, energetic indie in summer) while maintaining overall alignment with the Taste DNA.

## Quality Criteria & Strict Constraints
- **No Repeats:** Exclude every track already present in Input DNA and ensure zero duplicates within the output list.
- **Verified Spotify Catalog Only:** Include only real, verifiable tracks released on Spotify.
- **Clean Titles:** Omit version tags such as 'Live', 'Remastered', or 'Radio Edit'.
- **Exact Spotify Spelling:** Write artist and band names exactly as listed on Spotify with no self-transliteration.
- **Element Format:** Each array item must strictly follow "Artist - Track Name" (e.g., "Depeche Mode - Enjoy the Silence", "Mariya Takeuchi - Plastic Love", "Nürnberg - Biessenhofen").`;

  const userPrompt = `## Current Date
${formattedDate}

## Listening History (Input DNA)
${tracksJsonString}

Based on the Input DNA and seasonal context for ${formattedDate}, generate an array of exactly ${total} unique, real Spotify tracks formatted as "Artist - Track Name" following the mixing proportions (${coreCount} Core / ${pivotCount} Pivots / ${localCount} Local Spotlight / ${classicCount} Classics), with exact Spotify spelling, clean titles, and zero tracks repeated from Input DNA.`;

  return { systemInstruction, userPrompt };
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
    
    // 2. Take random tracks for analysis and compact them
    const randomTracks = Selector.sliceRandom(allTracks, AI_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
    const compactTracks = compactTracksForAi_(randomTracks);
    const { systemInstruction, userPrompt } = createTrackRecommendationPrompt_(JSON.stringify(compactTracks));
    
    // 3. Call Gemini
    Logger.log('🧠 Requesting AI...');
    const aiResult = callGeminiTextAPI(userPrompt, { systemInstruction });
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
