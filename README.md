# AI Spotify Playlist Generator

A Google Apps Script project that uses Google's Gemini AI to automatically generate personalized Spotify playlists and create unique, AI-generated cover art for them.

This script analyzes your existing music library from the Goofy library's cache, finds new track recommendations tailored to your taste, and designs a custom cover image that visually represents the playlist's mood.

## Key Features

-   **AI-Powered Recommendations:** Uses the Gemini AI model to analyze a sample of your music library and generate a list of new track recommendations.
-   **No Manual Export Needed:** Reads your "Liked Songs" directly from the cache file (`SavedTracks.json`) automatically maintained by the Goofy library.
-   **Custom Cover Art Generation:** Automatically generates a unique, atmospheric cover image for each playlist update using Gemini's image generation capabilities.
-   **Smart Playlist Management:** Incrementally updates a target playlist, adding new unique tracks and removing the oldest ones if the playlist exceeds a specified size limit.
-   **Automated Cleanup:** Includes a separate function to remove tracks you've recently listened to, keeping the playlist fresh.
-   **Highly Customizable:** All key parameters are configured at the top of the script file.

---

## Installation and Setup Guide

This guide will walk you through setting up the project from scratch.

### Prerequisites

-   A Google Account (for Google Apps Script).
-   A Spotify Account (Premium is recommended for full API access).

---

### Part 1: Initial Goofy Library Setup

This project is built on top of the powerful `goofy` library. Setting it up correctly is the most important step.

1.  **Follow the official Goofy installation guide**. Go to the link below and complete **all the steps**, including the "First Playlist" tutorial. This is crucial because it ensures Goofy is fully authorized and starts caching your saved tracks.
    -   **[Official Goofy Installation Guide](https://chimildic.github.io/goofy/#/install)**

2.  **What you will accomplish in this part:**
    -   Create a new Google Apps Script project.
    -   Create a Spotify Developer Application to get your `CLIENT_ID` and `CLIENT_SECRET`.
    -   Configure your project's `config.gs` file and authorize the script.
    -   **Crucially, Goofy will start creating a `SavedTracks.json` file in a `Goofy Data` folder on your Google Drive. This file is essential for our script.**

3.  **Wait for the cache to build.** After the initial setup, Goofy needs some time to build a complete cache of your "Liked Songs". This can take a few hours to a day, depending on your library size. You can proceed with the next steps while this happens in the background.

---

### Part 2: Gathering Your ID and API Key

Now, let's collect the credentials needed for our AI script.

#### A. Spotify Playlist ID (`SPOTIFY_PLAYLIST_ID`)

This is the ID of the playlist you want the script to manage. You can use an existing playlist or create a new empty one.

1.  Open Spotify.
2.  Find or create the playlist you want to use.
3.  Click the **`...`** (more options) button next to the playlist title.
4.  Go to **Share** -> **Copy link to playlist**.
5.  The link will look like this: `https://open.spotify.com/playlist/37i9dQZF1DXcBWXoPEoRv1?si=...`
6.  Your Playlist ID is the string of characters between `playlist/` and `?`. From the example above, it's `37i9dQZF1DXcBWXoPEoRv1`. **Copy this ID.**

#### B. Google Gemini API Key (`GEMINI_API_KEY`)

This is your personal key to access the Gemini AI model.

1.  Go to the **[Google AI Studio](https://aistudio.google.com/)**.
2.  Sign in with your Google Account.
3.  On the left panel, click **"Get API key"**.
4.  Click the **"Create API key in new project"** button.
5.  A new API key will be generated for you. **Copy this long string of characters** and save it somewhere safe. Treat this key like a password!

---

### Part 3: Adding and Configuring the Custom AI Script

Now we will add our AI-powered logic to the project.

1.  **Create a New File for the AI Script:**
    *   In the Apps Script editor, click the **`+`** icon next to "Files" to add a new file.
    *   Select **"Script"**.
    *   Name the new file **`AI_Playlist`** and press Enter.

2.  **Add the AI Script Code:**
    *   Open the new `AI_Playlist.gs` file.
    *   Copy the entire code from the `AI_Playlist.gs` file provided and paste it into this new, empty file in your project.

3.  **Configure the AI Script:**
    *   In the `AI_Playlist.gs` file you just created, find the `AI_CONFIG` block at the very top.
    *   Paste the Playlist ID you gathered in Part 2:
        ```javascript
        const AI_CONFIG = {
          SPOTIFY_PLAYLIST_ID: 'YOUR_SPOTIFY_PLAYLIST_ID_HERE', // <<<=== PASTE YOUR PLAYLIST ID
          // ... other settings ...
        };
        ```
    *   Review the other settings in `AI_CONFIG` and adjust them if needed.
    *   **Save the file** (<kbd>Ctrl</kbd>+<kbd>S</kbd>).

---

### Part 4: Final Configuration (Script Properties & Fine-Tuning)

#### A. Add your Gemini API Key

1.  In the Apps Script editor, click on **Project Settings** (gear icon ⚙️) on the left sidebar.
2.  Scroll down to the **"Script Properties"** section.
3.  Click **"Add script property"**.
4.  Enter the following:
    *   **Property:** `GEMINI_API_KEY`
    *   **Value:** Paste your Gemini API Key that you copied in Part 2.
5.  Click **"Save script properties"**.

#### B. Fine-Tune Search Accuracy (Recommended)

To get the best results, it's recommended to adjust Goofy's search sensitivity.

1.  Open the `config.gs` file in your project.
2.  Add the following line inside the `setProperties()` function:
    ```javascript
    UserProperties.setProperty('MIN_DICE_RATING', '0.70');
    ```
3.  **Why?** This setting controls how similar a track name from the AI must be to a search result from Spotify. The default is `0.6`. A higher value like `0.70` makes the search stricter and reduces the chance of adding incorrect tracks to your playlist.
4.  **Save the `config.gs` file.**

---

### Part 5: Running and Automating the Script

You are all set!

1.  **Run a Test:**
    *   In the Apps Script editor, ensure you are viewing the `AI_Playlist.gs` file.
    *   In the function dropdown menu at the top, select `generateAndCreateSpotifyPlaylist`.
    *   Click the **"Run"** button.
    *   The script will take a few minutes. You can monitor its progress in the "Execution log".
    *   If successful, your Spotify playlist will be updated with new tracks and a new, AI-generated cover!

2.  **Set Up Automation (Triggers):**
    *   To make the script run automatically, click on the **Triggers** (clock icon ⏰) on the left sidebar.
    *   Click **"Add Trigger"**.

    **Trigger 1: Daily Playlist Generation**
    *   **Choose which function to run:** `generateAndCreateSpotifyPlaylist`
    *   **Select event source:** `Time-driven`
    *   **Select type of time based trigger:** `Day timer`
    *   **Select time of day:** `4am to 5am` (or any time you prefer).
    *   Click **"Save"**.

    **Trigger 2: Hourly Playlist Cleanup (Optional)**
    *   Click **"Add Trigger"** again.
    *   **Choose which function to run:** `cleanUpPlaylist`
    *   **Select event source:** `Time-driven`
    *   **Select type of time based trigger:** `Hour timer`
    *   **Select hour interval:** `Every hour`.
    *   Click **"Save"**.
