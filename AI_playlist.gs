/**
 * @OnlyCurrentDoc
 * Main file for working with the Gemini AI to create Spotify playlists.
 */

// ===============================================================
//                           CONFIGURATION
// ===============================================================

const AI_CONFIG = {
  // === REQUIRED SETTINGS ===

  // The ID of the Spotify playlist that will be updated.
  // HOW TO GET IT: Go to your playlist on Spotify, click the "..." menu,
  // select "Share", and then "Copy link to playlist".
  // The ID is the string of letters and numbers after "playlist/" and before "?".
  // Example: '78uFpogH6uDyrEbFxzfp2L'
  SPOTIFY_PLAYLIST_ID: 'YOUR_SPOTIFY_PLAYLIST_ID_HERE', // <<<=== PASTE YOUR PLAYLIST ID HERE

  // The ID of your 'SavedTracks.json' file on Google Drive.
  // This file contains your Spotify library. You need to export it first.
  // HOW TO GET IT: Upload the file to Google Drive, right-click on it,
  // select "Get link", and make sure it's accessible. The ID is the long
  // string of letters and numbers in the link.
  GOOGLE_DRIVE_FILE_ID: 'YOUR_GOOGLE_DRIVE_FILE_ID_HERE', // <<<=== PASTE YOUR FILE ID HERE

  // === AI & PLAYLIST SETTINGS ===

  // The Gemini model to use for generating track recommendations.
  // 'gemini-2.5-pro' is powerful, 'gemini-2.5-flash' is faster and cheaper.
  GEMINI_MODEL: 'gemini-2.5-flash',

  // The number of random tracks from your library to be analyzed by the AI.
  // A larger sample size gives the AI a better understanding of your taste but takes longer.
  // 700 is a good balance.
  TRACK_SAMPLE_SIZE_FOR_AI: 700,

  // The maximum size of the final playlist.
  // If the playlist grows larger than this, the oldest tracks will be removed.
  MAX_PLAYLIST_SIZE: 500,

  // The template for the playlist name.
  // The {date} placeholder will be replaced with the current date (e.g., "AI Playlist from 8/16/2025").
  PLAYLIST_NAME_TEMPLATE: 'AI Playlist from {date}',

  // === PLAYLIST CLEANUP SETTINGS ===

  // The period (in days) for which listened tracks will be removed from the playlist.
  // This is used by the 'cleanUpPlaylist' function.
  // For example, 30 means any track you listened to in the last 30 days will be removed.
  CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS: 30,
};

// ===============================================================
//                MAIN PLAYLIST GENERATION FUNCTION
// ===============================================================

/**
 * The main function to generate and create/update a Spotify playlist using Gemini AI.
 * This is the function you should run on a schedule (e.g., daily).
 */
function generateAndCreateSpotifyPlaylist() {
  try {
    // --- 1. Get Settings and API Keys ---
    Logger.log('Starting the AI playlist creation process...');
    const geminiApiKey = getGeminiApiKey_();

    // --- 2. Fetch and Prepare Track Data ---
    Logger.log(`Fetching content of SavedTracks.json (ID: ${AI_CONFIG.GOOGLE_DRIVE_FILE_ID}) from Google Drive...`);
    const savedTracksJsonContent = getFileContentFromDrive_(AI_CONFIG.GOOGLE_DRIVE_FILE_ID);
    if (!savedTracksJsonContent) {
      throw new Error('Failed to retrieve content from SavedTracks.json.');
    }
    Logger.log(`Received ${savedTracksJsonContent.length} characters from the file.`);

    const randomTracksJsonString = prepareTracksForPrompt_(savedTracksJsonContent);

    // --- 3. Create the Prompt for Gemini ---
    Logger.log('Creating the prompt text for Gemini AI...');
    const promptText = createTrackRecommendationPrompt_(randomTracksJsonString);
    Logger.log(`Approximate prompt size: ${promptText.length} characters.`);

    // --- 4. Call the Gemini API for Track Recommendations ---
    Logger.log(`Calling the ${AI_CONFIG.GEMINI_MODEL} model...`);
    const aiResponseJsonString = callGeminiApi_(geminiApiKey, AI_CONFIG.GEMINI_MODEL, promptText);
    if (!aiResponseJsonString) {
      throw new Error('Received an empty or invalid response from the Gemini API.');
    }
    Logger.log('Received response from Gemini.');

    // --- 5. Parse the AI's Response ---
    Logger.log('Parsing the JSON response from the AI...');
    const tracksToSearch = parseAiResponse_(aiResponseJsonString);
    Logger.log(`AI recommended ${tracksToSearch.length} tracks to search for.`);

    if (tracksToSearch.length === 0) {
      Logger.log('AI returned no tracks to search for. Stopping execution.');
      return;
    }

    // --- 6. Interact with Spotify ---
    Logger.log(`Searching for ${tracksToSearch.length} tracks on Spotify...`);
    let foundSpotifyTracks = Search.multisearchTracks(tracksToSearch);
    Logger.log(`Found ${foundSpotifyTracks.length} tracks on Spotify.`);

    if (foundSpotifyTracks.length === 0) {
      Logger.log('No tracks were found on Spotify based on the AI recommendations. Stopping execution.');
      return;
    }

    // --- 7. Update the Playlist with New Tracks and Cover Art ---
    updatePlaylistIncrementally_(foundSpotifyTracks);

    Logger.log('Playlist creation/update process completed successfully.');

  } catch (error) {
    Logger.log(`CRITICAL ERROR: ${error.toString()}`);
    Logger.log(`Stack Trace: ${error.stack}`);
  }
}

// ===============================================================
//                PLAYLIST UPDATE AND COVER ART
// ===============================================================

/**
 * Incrementally updates the playlist: adds new unique tracks, trims old ones if the limit is exceeded,
 * generates a new cover, and resizes it via an external service.
 * @param {Array<Object>} foundSpotifyTracks An array of tracks recommended by the AI.
 */
function updatePlaylistIncrementally_(foundSpotifyTracks) {
  // 1. Get existing tracks from the target playlist
  Logger.log(`Getting existing tracks from playlist ID: ${AI_CONFIG.SPOTIFY_PLAYLIST_ID}...`);
  const existingPlaylistTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  Logger.log(`The playlist already contains ${existingPlaylistTracks.length} tracks.`);

  // 2. Filter the AI recommendations to keep only new, unique tracks
  let newUniqueTracks = Selector.sliceCopy(foundSpotifyTracks);
  Filter.removeTracks(newUniqueTracks, existingPlaylistTracks);
  Logger.log(`Found ${newUniqueTracks.length} new, unique tracks to add.`);

  if (newUniqueTracks.length === 0) {
    Logger.log('No new tracks to add. The playlist remains unchanged.');
    return;
  }

  // 3. Combine existing tracks with the new ones (new tracks at the beginning)
  let finalTrackList = [];
  Combiner.push(finalTrackList, newUniqueTracks, existingPlaylistTracks);
  Logger.log(`Total tracks after combining: ${finalTrackList.length}.`);

  // 4. Trim the playlist if it exceeds the maximum size
  if (finalTrackList.length > AI_CONFIG.MAX_PLAYLIST_SIZE) {
    const tracksToRemoveCount = finalTrackList.length - AI_CONFIG.MAX_PLAYLIST_SIZE;
    Logger.log(`Playlist exceeds the limit of ${AI_CONFIG.MAX_PLAYLIST_SIZE} tracks. Removing ${tracksToRemoveCount} of the oldest tracks...`);
    finalTrackList = finalTrackList.slice(0, AI_CONFIG.MAX_PLAYLIST_SIZE);
    Logger.log(`Final playlist size: ${finalTrackList.length}.`);
  }

  // 5. Generate and process the new cover art
  Logger.log('Attempting to generate and process a new cover art...');
  let coverImageBase64 = null;
  let tempFile = null; // Variable for the temporary file

  try {
    const originalImageBase64 = generatePlaylistCover_(finalTrackList);

    if (originalImageBase64) {
      Logger.log('Received image from AI. Uploading to Google Drive to get a shareable link...');
      const imageBlob = Utilities.newBlob(Utilities.base64Decode(originalImageBase64), 'image/jpeg', 'temp_cover.jpg');
      
      tempFile = DriveApp.createFile(imageBlob);
      tempFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      
      const imageUrlForResize = `https://drive.google.com/uc?id=${tempFile.getId()}`;
      
      Logger.log(`Attempting to resize the image via weserv.nl...`);
      const resizeServiceUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrlForResize)}&w=600&h=600&q=90&output=jpg`;
      
      const resizedResponse = UrlFetchApp.fetch(resizeServiceUrl, { 'muteHttpExceptions': true });
      
      if (resizedResponse.getResponseCode() === 200) {
        const resizedImageBlob = resizedResponse.getBlob();
        coverImageBase64 = Utilities.base64Encode(resizedImageBlob.getBytes());
        const finalSizeKB = Math.round(coverImageBase64.length * 0.75 / 1024);
        Logger.log(`✅ Image successfully resized. Final size: ${finalSizeKB} KB.`);
      } else {
        Logger.log(`⚠️ Image resizing service failed (Code: ${resizedResponse.getResponseCode()}). Skipping cover art update.`);
      }
    } else {
      Logger.log('Failed to generate cover art from AI.');
    }
  } catch (e) {
    Logger.log(`⚠️ A critical error occurred during cover art processing: ${e}.`);
  } finally {
    // Always delete the temporary file, whether the process succeeded or failed
    if (tempFile) {
      try {
        tempFile.setTrashed(true);
        Logger.log('Temporary cover art file has been deleted from Google Drive.');
      } catch (e) {
        Logger.log(`Failed to delete the temporary file: ${e}`);
      }
    }
  }

  // 6. Save the final playlist to Spotify
  const playlistName = AI_CONFIG.PLAYLIST_NAME_TEMPLATE.replace('{date}', new Date().toLocaleDateString('en-US'));
  const formattedDateTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMMM dd, yyyy, HH:mm');

  const playlistData = {
    id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
    name: playlistName,
    tracks: finalTrackList,
    description: `Last updated: ${formattedDateTime}. Added: ${newUniqueTracks.length} new tracks. Total tracks: ${finalTrackList.length}.`,
    coverImage: coverImageBase64
  };

  Logger.log(`Saving the final list of ${finalTrackList.length} tracks ${coverImageBase64 ? 'and the new cover art' : ''} to playlist "${playlistName}"...`);
  Playlist.saveWithReplace(playlistData);
}

// ===============================================================
//                     AI PROMPT CREATION
// ===============================================================

/**
 * Prepares a JSON string of random tracks to be inserted into the prompt.
 * @param {string} jsonContent The content of the SavedTracks.json file.
 * @return {string} A compact JSON string of random tracks.
 */
function prepareTracksForPrompt_(jsonContent) {
  Logger.log('Parsing SavedTracks.json and sampling tracks...');
  let allTracks;
  try {
    allTracks = JSON.parse(jsonContent);
    if (!Array.isArray(allTracks)) {
      throw new Error('The content of SavedTracks.json is not an array.');
    }
    Logger.log(`Successfully parsed ${allTracks.length} tracks.`);
  } catch (e) {
    Logger.log(`Error parsing SavedTracks.json: ${e}`);
    throw new Error('Could not parse the content of SavedTracks.json.');
  }

  Logger.log(`Randomly selecting ${AI_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI} tracks for AI analysis...`);
  const randomTracks = Selector.sliceRandom(allTracks, AI_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
  Logger.log(`Selected ${randomTracks.length} random tracks for analysis.`);
  
  return JSON.stringify(randomTracks);
}

/**
 * Creates the main prompt text for Gemini AI to get track recommendations.
 * @param {string} tracksJsonString A JSON string of tracks for analysis.
 * @return {string} The complete prompt text.
 */
function createTrackRecommendationPrompt_(tracksJsonString) {
  // This prompt is in Belarusian. You can translate or modify it to fit your needs.
  // The key is to be very specific about the AI's role, context, task, and output format.
  return `
[Role]: You are a music curator and researcher specializing in finding unexpected connections between different music scenes, genres, and eras. Your strength is finding a 70s Brazilian psychedelic rock band that would sound relevant to a modern British post-punk fan.

[Context]: I am providing you with a random sample of tracks from my music library. Your goal is to analyze my tastes and create a small but very precise playlist for discovering new music.

[Input Data]: A list of tracks in JSON format.
\`\`\`json
${tracksJsonString}
\`\`\`

[Task]:
1.  Analyze the input data to identify the main genres, moods, eras, and characteristic features of my musical taste.
2.  Based on this analysis, generate a list of 100 music tracks.

[Constraints and Rules]:
-   **No Duplicates:** DO NOT include tracks that are already in the input data.
-   **Prioritize Novelty:** Try to suggest artists that are not in the original list.
-   **Diversity:**
    -   ~70% of the recommendations should closely match the identified tastes.
    -   ~30% should be a bold "step aside": experiment with less obvious adjacent genres (e.g., if there's post-punk, suggest coldwave or minimal synth), different eras (70s, 2020s), or geographies (e.g., the Japanese alternative scene).
-   **Local Scene:** About 30% of the artists in the final list should be from Belarus.
-   **Language Filter:** Avoid songs in Russian.

[Output Format]:
-   The response must be EXCLUSIVELY a valid JSON array.
-   Each element of the array is a string in the format "Artist Name - Track Title".
-   Do not add any explanations, comments, markdown, or other text before or after the JSON block.

[Example]:
[
  "The Cure - A Forest",
  "Joy Division - Disorder",
  "Molchat Doma - Судно (Борис Рыжий)",
  "Lavon Volski - Паветраны шар"
]
`;
}

// ===============================================================
//                     COVER ART GENERATION
// ===============================================================

/**
 * Orchestrates the cover art generation process.
 * @param {Array<Object>} tracks An array of track objects for analysis.
 * @return {string|null} The Base64 string of the generated image, or null on failure.
 */
function generatePlaylistCover_(tracks) {
  try {
    Logger.log('Creating a text prompt for the image generator...');
    const imagePrompt = createImagePromptFromTracks_(tracks);
    if (!imagePrompt) {
      Logger.log('Failed to create an image prompt.');
      return null;
    }
    Logger.log(`Generated image prompt: "${imagePrompt}"`);

    Logger.log('Calling the Gemini Image Generation API...');
    const imageBase64 = callGeminiImageGenerationApi_(imagePrompt);
    return imageBase64;
  } catch (error) {
    Logger.log(`Error during cover art generation: ${error}`);
    return null;
  }
}

/**
 * Uses Gemini to create a professional and detailed prompt for the image model.
 * @param {Array<Object>} tracks An array of tracks.
 * @return {string|null} The generated text prompt.
 */
function createImagePromptFromTracks_(tracks) {
  const trackSample = Selector.sliceRandom(tracks, 50); 
  const trackListString = trackSample.map(t => `${t.artist} - ${t.name}`).join('\n');

  const promptForPrompt = `
[Role]: You are a professional art director and visual artist. You are an expert in creating highly effective prompts for AI image generators like Midjourney or DALL-E 3.

[Context]: I am giving you a list of music tracks. Your task is to analyze their combined mood, genre, and aesthetic to create a SINGLE, highly detailed, rich, and technically precise prompt for an AI image generator. This prompt will be used to create a square album cover.

[Input Data]:
${trackListString}

[Rules for the output prompt]:
-   **Technical Quality:** The prompt must include keywords that lead to high-quality images. Use terms like "hyperrealistic", "8k resolution", "intricate details", "photorealistic", "professional photography".
-   **Style and Aesthetics:** Suggest a very specific and evocative visual style. Examples: "cinematic still", "lomography photo", "double exposure", "retro-futurism", "surrealism", "gothic oil painting", "biopunk concept art". Be creative.
-   **Lighting and Composition:** Describe the lighting in detail. Use terms like "cinematic lighting", "volumetric light", "god rays", "moody lighting", "hard shadows".
-   **Camera and Lens:** For a photorealistic style, specify camera settings. Examples: "shot on Portra 400 film", "35mm lens", "shallow depth of field".
-   **Atmosphere:** Focus on abstract emotions, textures, and the overall atmosphere rather than literal scenes from the songs.
-   **Brevity:** The final prompt must be a single, concise paragraph, under 120 words.
-   **Language:** The prompt MUST be in English.

[Output Format]: ONLY the text of the prompt itself. Do not add any explanations, titles, quotation marks, or any other text before or after the prompt.

[Example of a perfect output]:
Cinematic wide-angle shot of a lone, glowing figure standing in a rain-slicked, neon-lit alleyway. Moody, atmospheric lighting with long shadows and volumetric fog. Shot on a 35mm lens with a shallow depth of field, Portra 400 film grain. Hyperrealistic, intricate details on the wet pavement. An atmosphere of melancholic solitude and urban decay.
`;

  try {
    const geminiApiKey = getGeminiApiKey_();
    const imagePromptText = callGeminiApi_(geminiApiKey, 'gemini-2.5-flash', promptForPrompt); 
    return imagePromptText ? imagePromptText.replace(/`/g, '') : null;
  } catch (e) {
    Logger.log(`Failed to create the image prompt: ${e}`);
    return null;
  }
}

// ===============================================================
//                       HELPER FUNCTIONS
// ===============================================================

/**
 * Parses the raw JSON string response from Gemini.
 * @param {string} aiResponseJsonString The raw string from the AI.
 * @return {Array<string>} An array of tracks to search for.
 */
function parseAiResponse_(aiResponseJsonString) {
  try {
    let tracks = JSON.parse(aiResponseJsonString);

    if (!Array.isArray(tracks)) {
      throw new Error('AI response is not an array, as required by the prompt.');
    }
    if (tracks.some(item => typeof item !== 'string')) {
      throw new Error('Some elements in the AI response array are not strings.');
    }
    return tracks;
  } catch (e) {
    Logger.log(`Error parsing response from Gemini: ${e.message}`);
    Logger.log(`Raw response that caused the error: ${aiResponseJsonString}`);
    throw new Error(`Failed to parse the response from Gemini. See logs for details.`);
  }
}

/**
 * Retrieves the Gemini API Key from Script Properties.
 * @return {string} The API key.
 */
function getGeminiApiKey_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error("API Key 'GEMINI_API_KEY' not found in Script Properties. Please set it via File > Project properties > Script properties.");
  }
  return apiKey;
}

/**
 * Retrieves the content of a file from Google Drive.
 * @param {string} fileId The ID of the file.
 * @return {string|null} The file content as a string.
 */
function getFileContentFromDrive_(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    return file.getBlob().getDataAsString('UTF-8');
  } catch (e) {
    Logger.log(`Error accessing Google Drive file ID ${fileId}: ${e}`);
    return null;
  }
}

/**
 * Calls the Gemini API to get text-based content (e.g., track recommendations).
 * @param {string} apiKey Your Gemini API key.
 * @param {string} model The model name.
 * @param {string} prompt The text prompt.
 * @return {string|null} The text content from the AI's response.
 */
function callGeminiApi_(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const requestPayload = {
     "contents": [{"parts": [{"text": prompt}]}],
     "generationConfig": {
       "temperature": 1.2,
       "responseMimeType": "application/json",
       "responseSchema": {"type": "array", "items": { "type": "string" }}
     },
     "safetySettings": [
        { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
      ]
   };
  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(requestPayload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode === 200) {
      const jsonResponse = JSON.parse(responseBody);
      if (jsonResponse.candidates && jsonResponse.candidates[0]?.content?.parts[0]?.text) {
         return jsonResponse.candidates[0].content.parts[0].text;
      } else {
         Logger.log(`Gemini API returned success code (200), but the response structure was unexpected. Body: ${responseBody}`);
         return null;
      }
    } else {
      Logger.log(`Error calling Gemini API. Response Code: ${responseCode}. Body: ${responseBody}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Exception during Gemini API call: ${error}`);
    return null;
  }
}

/**
 * Calls the Gemini API to generate an image.
 * @param {string} imagePrompt The text prompt for the image.
 * @return {string|null} The Base64 encoded string of the image.
 */
function callGeminiImageGenerationApi_(imagePrompt) {
  const apiKey = getGeminiApiKey_();
  const model = 'gemini-2.0-flash-preview-image-generation';
  const api = 'streamGenerateContent';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${api}?key=${apiKey}`;

  const requestPayload = {
    "contents": [{
      "parts": [{ "text": `Generate a single, high-quality, photorealistic square album cover based strictly on the following creative description: ${imagePrompt}` }]
    }],
    "generationConfig": {
      "responseModalities": ["IMAGE", "TEXT"]
    }
  };
  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(requestPayload),
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode === 200) {
      const chunks = JSON.parse(responseBody);
      for (const chunk of chunks) {
        if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData) {
          const imageData = chunk.candidates[0].content.parts[0].inlineData.data;
          if (imageData) {
            Logger.log('✅ Image data found in the API response.');
            return imageData;
          }
        }
      }
      Logger.log(`API returned code 200, but no image data was found in the response. Full response: ${responseBody}`);
      return null;
    } else {
      Logger.log(`Error calling Image Generation API. Code: ${responseCode}. Response: ${responseBody}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Exception during Image Generation API call: ${error}`);
    return null;
  }
}

// ===============================================================
//                  OPTIONAL CLEANUP FUNCTION
// ===============================================================

/**
 * This function is designed to be run on a schedule (e.g., hourly).
 * It removes tracks from the target playlist that you have recently listened to.
 */
function cleanUpPlaylist() {
  const playlistIdToClean = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
  Logger.log(`Hourly Cleanup: Starting for playlist ID: ${playlistIdToClean}`);

  try {
    let currentPlaylistTracks = Source.getPlaylistTracks('', playlistIdToClean);
    if (!currentPlaylistTracks || currentPlaylistTracks.length === 0) {
      Logger.log(`Hourly Cleanup: Playlist ${playlistIdToClean} is empty. Finishing.`);
      return;
    }
    const initialTrackCount = currentPlaylistTracks.length;
    Logger.log(`Hourly Cleanup: Found ${initialTrackCount} tracks in the playlist.`);

    // Get listening history and filter it by date
    Logger.log(`Hourly Cleanup: Getting listening history for the last ${AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS} days...`);
    let recentTracksHistory = RecentTracks.get();
    Filter.rangeDateRel(recentTracksHistory, AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS, 0);
    Logger.log(`Hourly Cleanup: Found ${recentTracksHistory.length} listened tracks in the specified period.`);

    // Remove the listened tracks from the current playlist
    Filter.removeTracks(currentPlaylistTracks, recentTracksHistory);
    const finalTrackCount = currentPlaylistTracks.length;

    if (finalTrackCount < initialTrackCount) {
      Logger.log(`Hourly Cleanup: ${initialTrackCount - finalTrackCount} tracks will be removed. Updating the playlist...`);
      Playlist.saveWithReplace({
        id: playlistIdToClean,
        tracks: currentPlaylistTracks,
      });
      Logger.log(`Hourly Cleanup: Playlist ${playlistIdToClean} was successfully updated.`);
    } else {
      Logger.log(`Hourly Cleanup: No tracks to remove were found. The playlist remains unchanged.`);
    }
  } catch (error) {
    Logger.log(`Hourly Cleanup ERROR: ${error}`);
    Logger.log(`Stack: ${error.stack}`);
  }
}
