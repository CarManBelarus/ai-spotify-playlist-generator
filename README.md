# AI Spotify Playlist Generator

A Google Apps Script project that uses Google's Gemini AI to automatically generate personalized Spotify playlists and create unique, AI-generated cover art for them.

This script analyzes your existing music library, finds new track recommendations tailored to your taste, and even designs a custom cover image that visually represents the playlist's mood.

## Features

-   **AI-Powered Recommendations:** Uses the Gemini AI model to analyze a sample of your music library and generate a list of 100 new track recommendations.
-   **Custom Cover Art Generation:** Automatically generates a unique, atmospheric cover image for each playlist update using Gemini's image generation capabilities.
-   **Smart Playlist Management:** Incrementally updates your target playlist, adding new unique tracks and removing the oldest ones if the playlist exceeds a specified size limit.
-   **Automated Cleanup:** Includes a separate function that can be run on a schedule to remove tracks you've recently listened to or "liked" from the AI playlist, keeping it fresh.
-   **Highly Customizable:** All key parameters (playlist IDs, AI models, sample sizes, etc.) are configured in a single `config.gs` file.

## How It Works

1.  **Track Analysis:** The script reads a sample of tracks from your `SavedTracks.json` file (exported from your Spotify library).
2.  **Music Recommendations:** It sends the track list to the Gemini AI with a detailed prompt, asking it to act as a music curator and recommend new songs, including a percentage of Belarusian artists.
3.  **Spotify Search:** The recommended tracks are searched for on Spotify.
4.  **Playlist Update:** The found tracks are added to your designated Spotify playlist, respecting size limits.
5.  **Cover Art Generation:**
    *   The final track list is sent back to Gemini with a "prompt-for-a-prompt" request, asking it to act as an art director and create a detailed, professional prompt for an image generator.
    *   This high-quality prompt is then used to generate a unique cover image.
    *   The generated image is resized using the `images.weserv.nl` service to meet Spotify's 256 KB upload limit.
6.  **Final Save:** The playlist is updated on Spotify with the new tracks and the new custom cover art.

## Setup

#### 1. Google Apps Script Project
-   Create a new Google Apps Script project.
-   Copy the contents of `main.gs`, `config.gs`, and `appsscript.json` into your project.
-   **Important:** Create a file named `library.js` and copy the contents of the modified Goofy library (version 2.2.0 with the `coverImage` fix) into it.

#### 2. Goofy Library
-   This project depends on the **Goofy** library. Add it to your project using its Script ID. Refer to the official Goofy documentation for instructions.

#### 3. Script Properties
-   Go to `Project Settings` > `Script Properties` and add your `GEMINI_API_KEY`.

#### 4. Configuration
-   Open `config.gs` and fill in the required constants in the `AI_CONFIG` object:
    -   `SPOTIFY_PLAYLIST_ID`: The ID of the Spotify playlist you want to manage.
    -   `GOOGLE_DRIVE_FILE_ID`: The ID of your `SavedTracks.json` file on Google Drive.

#### 5. Triggers
-   Set up time-based triggers in Apps Script to run the main functions automatically:
    -   `generateAndCreateSpotifyPlaylist`: Run daily or weekly to update your playlist.
    -   `cleanUpPlaylistHourly_Optimized`: Run hourly to keep the playlist clean.

## Dependencies

-   [Goofy for Spotify](https://github.com/Chimildic/goofy) (v2.2.0, with a custom modification to `changeCover`)
-   Google Gemini API
-   `images.weserv.nl` for image resizing.

---

_This project is a personal experiment in combining AI and music automation._
