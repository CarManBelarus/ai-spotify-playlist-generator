# AI Spotify Playlist Generator

A Google Apps Script project that leverages **Google's Gemini AI** to generate personalized Spotify playlists and **Hugging Face** to create unique, AI-generated cover art.

This repository contains a set of add-on scripts for the [Goofy library](https://chimildic.github.io/goofy/) that enable advanced automation and smart playlist creation.

## Project Components

The project consists of two main scripts:

1.  ### `AI_playlist.gs` (Automated Daily Playlist)
    The core script for maintaining a personal "Discovery Playlist". It runs automatically on a schedule.

    -   **Library Analysis:** Scans your saved tracks (`SavedTracks.json`) to understand your musical taste.
    -   **Multi-Model AI:** Uses a robust fallback system: if the primary model (Gemini Pro) is overloaded, it automatically switches to a backup (Flash) to ensure reliability.
    -   **Smart Updates:** Daily adds fresh recommendations to the top of the playlist while preserving history, and trims the oldest tracks when the limit is reached.
    -   **Premium Cover Art:** Generates high-quality covers using top-tier models like **FLUX.1** (with fallback to Stable Diffusion 3 and XL).

2.  ### `AI_Generator.gs` (Universal On-Demand Generator)
    A flexible tool for creating thematic playlists manually. Controlled via configuration changes.

    -   **Two Modes:** Can create playlists based on a text topic (**Topic Mode**) or based on an existing playlist template (**Playlist Mode** - creating a sequel).
    -   **Create or Update:** Supports creating brand new playlists or completely overwriting existing ones.
    -   **Smart Naming:** Automatically generates short, catchy titles for your new playlists based on your prompt.

---

## Installation and Setup Guide

This guide will walk you through setting up the project from scratch.

### Prerequisites

-   A Google Account (for Google Apps Script).
-   A Spotify Account (Premium recommended for full API access).
-   A Hugging Face Account (free, required for cover art).

---

### Part 1: Initial Goofy Library Setup

This project is an extension of the `goofy` library. Setting it up correctly is the first step.

1.  **Follow the official Goofy installation guide.**
    -   **[Official Goofy Installation Guide](https://chimildic.github.io/goofy/#/install)**
    Complete **all steps**, including the "First Playlist" tutorial. This ensures Goofy is authorized and begins caching your library.

2.  **Wait for the cache to build.** After setup, Goofy needs time to create the `SavedTracks.json` file in your Google Drive. This is essential for the AI analysis.

---

### Part 2: Gathering IDs and API Keys

Collect the following credentials:

1.  **Spotify Playlist ID:**
    *   Open Spotify (Web or App).
    *   Right-click on a playlist -> "Share" -> "Copy link to playlist".
    *   The ID is the string of characters after `playlist/` and before `?`.

2.  **Google Gemini API Key:**
    *   Create a free key at **[Google AI Studio](https://aistudio.google.com/)**.

3.  **Hugging Face API Key + Access (IMPORTANT):**
    *   Create a token in your **[Hugging Face Settings](https://huggingface.co/settings/tokens)** (type `read`).
    *   **⚠️ CRITICAL STEP:** This project uses the powerful **FLUX.1** models. To use them, you **must** visit the links below and click **"Agree and access repository"** to accept the license:
        *   [Access black-forest-labs/FLUX.1-dev](https://huggingface.co/black-forest-labs/FLUX.1-dev)
        *   [Access black-forest-labs/FLUX.1-schnell](https://huggingface.co/black-forest-labs/FLUX.1-schnell)
    *   *Without this step, cover art generation will fail with a 403 error.*

---

### Part 3: Adding and Configuring AI Scripts

1.  **Create new files in your Goofy project:**
    *   Click `+` next to "Files" -> **Script**.
    *   Create a file named **`AI_Playlist`**.
    *   Create a second file named **`AI_Generator`**.

2.  **Add the code:**
    *   Copy the content of `AI_playlist.gs` from this repository into your `AI_Playlist` file.
    *   Copy the content of `AI_Generator.gs` into your `AI_Generator` file.

3.  **Configure the scripts:**
    *   In `AI_Playlist.gs`, locate the `AI_CONFIG` block and paste your **Spotify Playlist ID**.
    *   In `AI_Generator.gs`, modify the `GENERATOR_CONFIG` block whenever you want to run a manual generation task.
    *   **Save both files** (<kbd>Ctrl</kbd>+<kbd>S</kbd>).

---

### Part 4: Final Configuration

1.  **Add API Keys to Script Properties:**
    *   Go to **Project Settings** (⚙️) -> **Script Properties**.
    *   Add two properties:
        *   `GEMINI_API_KEY`: Your Google Gemini key.
        *   `HUGGINGFACE_API_KEY`: Your Hugging Face token.
    *   Save the properties.

2.  **Fine-Tune Search Accuracy (Recommended):**
    *   Open `config.gs` and add this line inside the `setProperties()` function:
        ```javascript
        UserProperties.setProperty('MIN_DICE_RATING', '0.70');
        ```
    *   This improves the accuracy of track matching on Spotify.

---

### Part 5: Running and Automating

#### Automating the Daily Playlist (`AI_Playlist.gs`)

1.  Go to **Triggers** (⏰).
2.  Create a trigger for `generateAndCreateSpotifyPlaylist` -> `Time-driven` -> `Day timer` (e.g., Midnight to 1am).
3.  *(Optional)* Create a trigger for `cleanUpPlaylist` -> `Time-driven` -> `Hour timer` (Every hour).

#### Running the Universal Generator (`AI_Generator.gs`)

This script is run manually on demand.

1.  Open `AI_Generator.gs`.
2.  Adjust `GENERATOR_CONFIG` (choose mode, topic, or source playlist).
3.  Select `generateCustomPlaylist` from the dropdown menu.
4.  Click **"Run"**.
5.  Watch the "Execution log" and enjoy your new playlist!
