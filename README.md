# AI Spotify Playlist Generator

A Google Apps Script project that uses Google's Gemini AI to automatically generate personalized Spotify playlists and create unique, AI-generated cover art for them.

This script analyzes your existing music library, finds new track recommendations tailored to your taste, and even designs a custom cover image that visually represents the playlist's mood.

## Key Features

-   **AI-Powered Recommendations:** Uses the Gemini AI model to analyze a sample of your music library and generate a list of 100 new track recommendations.
-   **Custom Cover Art Generation:** Automatically generates a unique, atmospheric cover image for each playlist update using Gemini's image generation capabilities.
-   **Smart Playlist Management:** Incrementally updates a target playlist, adding new unique tracks and removing the oldest ones if the playlist exceeds a specified size limit.
-   **Automated Cleanup:** Includes a separate function that can be run on a schedule to remove tracks you've recently listened to from the AI playlist, keeping it fresh.
-   **Highly Customizable:** All key parameters are configured at the top of the script file.

---

## Installation and Setup Guide

This guide will walk you through setting up the project from scratch.

### Prerequisites

- A Google Account (for Google Apps Script and Google Drive).
- A Spotify Account (Premium is recommended for full API access).
- An exported `SavedTracks.json` file containing your Spotify library (you can use a tool like [Exportify](https://exportify.net/)).

---

### Part 1: Initial Goofy Library Setup

This project is built on top of the powerful `goofy` library. We'll start by setting up the original library first.

1.  **Follow the official Goofy installation guide**. Go to the link below and complete **Steps 1 through 8**:
    -   **[Official Goofy Installation Guide](https://chimildic.github.io/goofy/#/install)**

2.  **What you will accomplish in this part:**
    -   Create a new Google Apps Script project (which will include files like `main.gs`, `config.gs`, and `library.js`).
    -   Create a Spotify Developer Application to get your `CLIENT_ID` and `CLIENT_SECRET`.
    -   Configure your project's `config.gs` file with these keys.
    -   Authorize the script to access your Spotify account.

3.  **STOP after Step 8!** Do not proceed to their "First Playlist" tutorial. We will be adding our own script in a separate file.

### Part 2: Gathering Your IDs and API Key

Before we add our code, let's collect all the necessary credentials.

#### A. Spotify Playlist ID (`SPOTIFY_PLAYLIST_ID`)

This is the ID of the playlist you want the script to manage. You can use an existing playlist or create a new empty one.

1.  Open Spotify (desktop app or web player).
2.  Find or create the playlist you want to use.
3.  Click the **`...`** (more options) button next to the playlist title.
4.  Go to **Share** -> **Copy link to playlist**.
5.  The link will look like this: `https://open.spotify.com/playlist/37i9dQZF1DXcBWXoPEoRv1?si=...`
6.  Your Playlist ID is the string of characters between `playlist/` and `?`. From the example above, it's `37i9dQZF1DXcBWXoPEoRv1`. **Copy this ID.**

#### B. Google Drive File ID (`GOOGLE_DRIVE_FILE_ID`)

This is the ID of your `SavedTracks.json` file.

1.  Upload the `SavedTracks.json` file (that you exported earlier) to your Google Drive.
2.  Right-click on the uploaded file in Google Drive and select **"Get link"**.
3.  In the sharing dialog, change the access from "Restricted" to **"Anyone with the link"**.
4.  The link will look like this: `https://drive.google.com/file/d/1HSP3c4QofqNnE4b4OE1uIMStLF1NRPr8/view?usp=sharing`
5.  Your File ID is the long string of characters between `d/` and `/view`. From the example, it's `1HSP3c4QofqNnE4b4OE1uIMStLF1NRPr8`. **Copy this ID.**

#### C. Google Gemini API Key (`GEMINI_API_KEY`)

This is your personal key to access the Gemini AI model.

1.  Go to the **[Google AI Studio](https://aistudio.google.com/)**.
2.  Sign in with your Google Account.
3.  On the left panel, click **"Get API key"**.
4.  Click the **"Create API key in new project"** button.
5.  A new API key will be generated for you. **Copy this long string of characters** and save it somewhere safe. Treat this key like a password!

---

### Part 3: Adding and Configuring the Custom AI Script

Now we will add our AI-powered logic to the project.

1.  **Replace `library.js` with the modified version:**
    *   The original Goofy v2.2.0 library does not support setting a cover image from Base64 data. Our modified version fixes this.
    *   In your Apps Script project, open the `library.js` file.
    *   Delete all of its content (<kbd>Ctrl</kbd>+<kbd>A</kbd>, then `Delete`).
    *   Copy the entire code from **[our modified `library.js` file](https://github.com/your-username/your-repo/blob/main/library.js)** and paste it into the now-empty file.
    *   **Save the file** (<kbd>Ctrl</kbd>+<kbd>S</kbd>).

2.  **Create a New File for the AI Script:**
    *   In the Apps Script editor, click the **`+`** icon next to "Files" to add a new file.
    *   Select **"Script"**.
    *   Name the new file **`AI_Playlist`** and press Enter.

3.  **Add the AI Script Code:**
    *   Open the new `AI_Playlist.gs` file.
    *   Copy the entire code from **[our `AI_Playlist.gs` file](https://github.com/your-username/your-repo/blob/main/AI_Playlist.gs)** (the English, commented version) and paste it into this file.

4.  **Configure the AI Script:**
    *   In the `AI_Playlist.gs` file you just created, find the `AI_CONFIG` block at the very top.
    *   Paste the IDs you gathered in Part 2 into the placeholder values:
        ```javascript
        SPOTIFY_PLAYLIST_ID: 'YOUR_SPOTIFY_PLAYLIST_ID_HERE', // <<<=== PASTE YOUR PLAYLIST ID
        GOOGLE_DRIVE_FILE_ID: 'YOUR_GOOGLE_DRIVE_FILE_ID_HERE', // <<<=== PASTE YOUR FILE ID
        ```
    *   **Save the file** (<kbd>Ctrl</kbd>+<kbd>S</kbd>).

---

### Part 4: Final Configuration (Script Properties)

The last step is to add your secret Gemini API key to the project's secure storage.

1.  In the Apps Script editor, click on the **Project Settings** (gear icon ⚙️) on the left sidebar.
2.  Scroll down to the **"Script Properties"** section.
3.  Click **"Add script property"**.
4.  Enter the following:
    *   **Property:** `GEMINI_API_KEY`
    *   **Value:** Paste your Gemini API Key that you copied in Part 2.
5.  Click **"Save script properties"**.

---

### Part 5: Running and Automating the Script

You are all set!

1.  **Run a Test:**
    *   In the Apps Script editor, make sure you are viewing the `AI_Playlist.gs` file.
    *   In the function dropdown menu at the top, select `generateAndCreateSpotifyPlaylist`.
    *   Click the **"Run"** button.
    *   The script will take a few minutes to execute. You can monitor its progress in the "Execution log" at the bottom of the screen.
    *   If everything is successful, your Spotify playlist will be updated with new tracks and a new, AI-generated cover!

2.  **Set Up Automation (Triggers):**
    *   To make the script run automatically, click on the **Triggers** (clock icon ⏰) on the left sidebar.
    *   Click the **"Add Trigger"** button in the bottom right.
    *   Configure the trigger for the main function:
        *   **Choose which function to run:** `generateAndCreateSpotifyPlaylist`
        *   **Select event source:** `Time-driven`
        *   **Select type of time based trigger:** `Day timer`
        *   **Select time of day:** `4am to 5am` (or any time you prefer).
    *   Click **"Save"**.

3.  **(Optional) Set Up Cleanup Trigger:**
    *   You can create a second trigger for the `cleanUpPlaylist` function to run more frequently (e.g., `Hour timer`, `Every hour`) to keep your playlist fresh.
