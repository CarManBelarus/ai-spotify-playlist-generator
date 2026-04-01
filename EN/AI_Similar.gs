/**
 * @OnlyCurrentDoc
 * AI_Similar.gs - Generates a playlist based on the "DNA" analysis of a source playlist.
 * Requires AI_General.gs to function properly.
 */

const CLONE_CONFIG = {
  // ID of the source playlist (What we analyze)
  SOURCE_PLAYLIST_ID: 'INSERT_SOURCE_PLAYLIST_ID',

  // ID of the target playlist (Where we save the result)
  TARGET_PLAYLIST_ID: 'INSERT_TARGET_PLAYLIST_ID',

  // Number of random sample tracks to send to the AI (up to 500 to save tokens)
  TRACK_SAMPLE_SIZE_FOR_AI: 400,
  
  // Number of tracks we expect the AI to return
  NUMBER_OF_TRACKS_TO_REQUEST: 150,

  PLAYLIST_NAME_TEMPLATE: 'AI Recommendations: {source_name}',
  
  // --- SORTING SETTINGS ---
  SMART_SORT_ENABLED: true,
  SMART_SORT_PRESET: 'radio' // 'atmospheric', 'drive', 'radio'
};

/**
 * Main function: Generates a continuation playlist based on an existing one.
 */
function generatePlaylistFromSourcePlaylist() {
  try {
    Logger.log('🧬 Starting the playlist cloning and expansion process...');
    
    // 1. Fetching source playlist data (Using safe native Goofy method)
    const sourcePlaylistInfo = Playlist.getById(CLONE_CONFIG.SOURCE_PLAYLIST_ID);
    if (!sourcePlaylistInfo || !sourcePlaylistInfo.name) {
        throw new Error(`Unable to get metadata for source playlist: ${CLONE_CONFIG.SOURCE_PLAYLIST_ID}`);
    }
    
    const sourcePlaylistName = sourcePlaylistInfo.name;
    const sourceTracks = Source.getPlaylistTracks('', CLONE_CONFIG.SOURCE_PLAYLIST_ID);
    
    if (!sourceTracks || sourceTracks.length === 0) {
      throw new Error('❌ Source playlist is empty. DNA analysis is impossible.');
    }
    Logger.log(`✅ Found ${sourceTracks.length} tracks in "${sourcePlaylistName}".`);

    // 2. Sample preparation and prompt creation (Token Optimization)
    const randomSample = Selector.sliceRandom(sourceTracks, CLONE_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
    const compactSampleList = randomSample.map(t => `${t.artists[0].name} - ${t.name}`);
    const promptText = createClonePrompt_(sourcePlaylistName, JSON.stringify(compactSampleList));

    // 3. Requesting global AI engine
    Logger.log('🧠 Sending playlist DNA for AI analysis...');
    const aiResult = callGeminiTextAPI(promptText);
    const rawAiTracks = parseAiResponse(aiResult.responseText);
    
    if (!rawAiTracks || rawAiTracks.length === 0) {
      throw new Error('⚠️ AI returned no valid tracks. Process stopped.');
    }
    Logger.log(`🎯 AI suggested ${rawAiTracks.length} recommendations.`);

    // 4. Bulletproof search with anti-hallucination mechanisms
    const foundSpotifyTracks = executeSmartSearch(rawAiTracks);
    if (foundSpotifyTracks.length === 0) {
      throw new Error('⚠️ No matches found in Spotify after search. Stopping.');
    }

    // 5. Filtering and Saving
    saveRecommendationsToPlaylist_(foundSpotifyTracks, sourceTracks, sourcePlaylistName);
    
    // 6. Cover generation and sorting
    generateAndApplyCover(CLONE_CONFIG.TARGET_PLAYLIST_ID, foundSpotifyTracks);
    if (CLONE_CONFIG.SMART_SORT_ENABLED) {
      applySmartSort(CLONE_CONFIG.TARGET_PLAYLIST_ID, CLONE_CONFIG.SMART_SORT_PRESET);
    }

    Logger.log('🎉 Process completed successfully.');

  } catch (error) {
    Logger.log(`❌ CRITICAL ERROR: ${error.toString()}\nStack: ${error.stack}`);
  }
}

/**
 * Builds a system prompt for the model based on the playlist's DNA.
 */
function createClonePrompt_(playlistName, tracksJsonString) {
  const total = CLONE_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST;
  const groupA = Math.round(total * 0.60); // 60%
  const groupB = Math.round(total * 0.20); // 20%
  const groupC = total - groupA - groupB;  // 20%

  return `
<system_instruction>
    <role>
        You are an Elite Music Curator and audio engineer. Your specialization is creating playlist-journeys based on the deep psycho-acoustic analysis of a given musical DNA.
    </role>

    <objective>
        Analyze the source playlist "${playlistName}" and generate a new list of exactly ${total} tracks that will serve as a logical, yet unexpected continuation of the original.
    </objective>

    <context_awareness>
        [Source DNA]: The following array contains tracks from the original playlist. Determine its main genres, era, tempo, and emotional charge.
        ${tracksJsonString}
    </context_awareness>

    <behavioral_guidelines>
        Build the final mix by intellectually blending three categories (distribute them evenly throughout the playlist, do not group them):
        1. **Group A: Expansion (~${groupA} tracks):** Perfect match with the genre and mood of the source playlist. Well-known and respected artists in this direction.
        2. **Group B: Deepening (~${groupB} tracks):** "Hidden gems" (B-sides, lesser-known bands of the same style or era).
        3. **Group C: Evolution (~${groupC} tracks):** Adjacent genres and "bridges". Tracks that sonically resonate with the DNA but belong to a different era or style (showcasing taste evolution).
    </behavioral_guidelines>

    <strict_constraints>
        * **NO DUPLICATES:** You are STRICTLY FORBIDDEN from including any track or artist that is already present in the [Source DNA].
        * **OUTPUT FORMAT:** Output exclusively a JSON array of strings. No markdown, no introductory words, no comments.
        * **PRECISION:** The format of each string must strictly be "Artist - Track Name". The number of elements must be exactly ${total}.
    </strict_constraints>
</system_instruction>
`;
}

/**
 * Filters the result and writes it to the target playlist.
 */
function saveRecommendationsToPlaylist_(recommendedTracks, sourceTracks, sourcePlaylistName) {
  Logger.log('🧹 Filtering results from duplicates and existing tracks...');
  
  let uniqueNewTracks = Selector.sliceCopy(recommendedTracks);
  Filter.dedupTracks(uniqueNewTracks);
  Filter.removeTracks(uniqueNewTracks, sourceTracks);
  
  if (uniqueNewTracks.length === 0) {
      throw new Error('⚠️ No unique tracks left after filtering. Save aborted.');
  }
  
  const dateStr = new Date().toLocaleDateString('en-US');
  const playlistName = CLONE_CONFIG.PLAYLIST_NAME_TEMPLATE.replace('{source_name}', sourcePlaylistName).substring(0, 100);
  const playlistDescription = `Generated on ${dateStr}. DNA analysis of playlist "${sourcePlaylistName}". Total tracks: ${uniqueNewTracks.length}.`;

  Logger.log(`💾 Saving ${uniqueNewTracks.length} tracks to the target playlist...`);
  
  Playlist.saveWithReplace({
    id: CLONE_CONFIG.TARGET_PLAYLIST_ID,
    tracks: uniqueNewTracks
  });

  // Reliable metadata update via ABSOLUTE Spotify API path
  SpotifyRequest.put(`https://api.spotify.com/v1/playlists/${CLONE_CONFIG.TARGET_PLAYLIST_ID}`, {
    name: playlistName,
    description: playlistDescription
  });
}