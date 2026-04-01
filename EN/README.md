# AI Spotify Playlist Generator

A Google Apps Script project that leverages **Google's Gemini AI** (Pro & Flash models) to generate personalized Spotify playlists and unique cover art, **Pollinations AI** (Flux model) as a fallback image generator, and the **FlowSort** algorithm for perfect DJ-style track sequencing.

This repository contains a set of add-on scripts for the [Goofy library](https://chimildic.github.io/goofy/) that enable advanced automation and smart playlist creation.

## Key Features (Version 6.0 Enterprise)

-   **Playlist DNA Cloning:** Analyzes the mood, era, and genres of any existing playlist and creates its perfect continuation.
-   **Data Safety & Mutexes:** Implemented a locking system (`LockService`). Generation and cleanup triggers will never overlap or corrupt your playlist data again.
-   **Point Deletion (Non-Destructive Cleanup):** The script removes listened tracks selectively via Spotify API, preserving the original "Date Added" timestamps and playlist metadata.
-   **Multi-Model AI (Cascade):** Built-in resilience. If the primary Gemini model (text or image) is overloaded, the script automatically falls back to secondary models or external APIs.
-   **Bilingual Search:** Understands and searches for tracks in both Latin and Cyrillic with a custom anti-cover/tribute filter.

## Project Structure (Modular Architecture)

The project is divided into four files for convenience and to avoid code duplication:

1.  ### `AI_General.gs` (The Engine)
    The central file containing API keys, model settings, cascading logic for Gemini, cover art generation, and "bulletproof" Spotify track search algorithms.
2.  ### `AI_Playlist.gs` (Daily "Discovery" Playlist)
    Analyzes your saved tracks (`SavedTracks.json`) and automatically generates a daily mix of new music based on your "Taste DNA" and calendar holidays. Can run automatically via a trigger.
3.  ### `AI_Generator.gs` (On-Demand Generator)
    A tool for creating thematic playlists via text prompts (e.g., "Music for a night road trip"). Run this manually when you need a specific mix.
4.  ### `AI_Similar.gs` (Playlist DNA Cloning)
    An innovative module that reads the "DNA" of any existing playlist (mood, era, cross-genres) and generates its perfect continuation. It sends up to 400 sample tracks to the AI model for deep psycho-acoustic analysis.

---

## Installation and Setup Guide

This guide will walk you through setting up the project from scratch.

### Prerequisites
-   A Google Account (for Google Apps Script).
-   A Spotify Account (Premium recommended).

---

### Part 1: Initial Goofy Library Setup

1.  **Get the Goofy version.**
    -   We recommend using the stable localized fork: **[CarManBelarus / goofy](https://github.com/CarManBelarus/goofy)**. Copy the contents of `library.js` and `config.gs`.
2.  **Follow the official Goofy installation guide.**
    -   **[Official Goofy Installation Guide](https://chimildic.github.io/goofy/#/install)**
    Complete all steps, including Spotify authorization.
3.  **Wait for the cache to build.** After Goofy setup, it takes time to create the `SavedTracks.json` file in your Google Drive. This is crucial for taste analysis.

---

### Part 2: Gathering IDs and API Keys

1.  **Spotify Playlist ID:** (Right-click your playlist -> Share -> Copy link). The ID is the characters after `playlist/`. You will need it for the target playlist variables.
2.  **Google Gemini API Key:** Create a free key at **[Google AI Studio](https://aistudio.google.com/)**. *This is the only key you will need to run the entire system.*

---

### Part 3: Adding Scripts and FlowSort Algorithm

In your Google Apps Script project, click `+` (Add file -> Script) and create the following files:

1.  **`FlowSort.gs`**
    *   The script requires an external sorting algorithm. Go to the author's repository: **[Tavi1977 / flowsort-balanced-wave](https://github.com/Tavi1977/flowsort-balanced-wave)**.
    *   Copy the contents of `flowsort_sortBalancedWave.js` and paste it into your `FlowSort.gs` file.
    *   *Important: Move this file up in your file list (right below `library.gs`).*
2.  **`AI_General.gs`** — copy the code from the corresponding file in this repository.
3.  **`AI_Playlist.gs`** — copy the code and insert your *Spotify Playlist ID* into the `SPOTIFY_PLAYLIST_ID` variable.
4.  **`AI_Generator.gs`** — copy the code. Change the `TOPIC_PROMPT` variable before running it manually.
5.  **`AI_Similar.gs`** — copy the code and set the `SOURCE_PLAYLIST_ID` (what to analyze) and `TARGET_PLAYLIST_ID` (where to save) variables.

---

### Part 4: Final Configuration

1. Go to **Project Settings** (⚙️) -> **Script Properties**.
2. Add just one key:
    *   Property: `GEMINI_API_KEY`
    *   Value: your Google Gemini key.
3. Save properties.

---

### Part 5: Running and Automating

*   **Automation (Triggers):** Go to Triggers (⏰). Create a trigger for `generateAndCreateSpotifyPlaylist` (e.g., daily at night). For cleaning up listened tracks, add a trigger for `cleanUpPlaylist` (e.g., every hour). *The system is fully protected by mutexes — if generation and cleanup overlap, they will not break each other.*
*   **Manual Run:** Open the desired file (e.g., `AI_Generator.gs`), select the main function at the top of the screen, and click **"Run"**.
