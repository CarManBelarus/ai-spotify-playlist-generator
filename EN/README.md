# AI Spotify Playlist Generator

A Google Apps Script project that leverages **Google's Gemini 4 AI** (`gemini-4-hydrogen`, `gemini-4-neon`) to generate personalized Spotify playlists, **Gemini Nano Banana 2.1** (`gemini-nano-banana-2.1`) with **Pollinations AI** (Flux model) as a fallback for unique cover art, and the **FlowSort** algorithm for perfect DJ-style track sequencing.

This repository contains a set of add-on scripts for the [Goofy library](https://chimildic.github.io/goofy/) that enable advanced automation and smart playlist creation.

## Key Features (Version 6.2 Enterprise)

-   **Gemini 4 Engine & Structured Outputs:** Upgraded to the Gemini 4 family (`gemini-4-hydrogen` primary, `gemini-4-neon` fallback, plus `gemini-3.8-flash` and `gemini-3.5-flash-lite`) with tunable `thinkingLevel`, native `systemInstruction` separation, and strict JSON `responseSchema` validation for zero parsing failures and fewer track hallucinations.
-   **Nano Banana 2.1 Cover Art:** Uses `gemini-nano-banana-2.1` (with `MINIMAL` thinking and Semantic Negative Prompting) for faster, higher-quality, and ~2× more cost-efficient 1:1 album covers, backed by automatic Google Drive compression (under Spotify's 250 KB limit) and Pollinations Flux fallback.
-   **Playlist DNA Cloning:** Analyzes the mood, era, and genres of any existing playlist and creates its perfect continuation.
-   **Data Safety & Mutexes:** Implemented a locking system (`LockService`). Generation and cleanup triggers will never overlap or corrupt your playlist data again.
-   **Point Deletion (Non-Destructive Cleanup):** The script removes listened tracks selectively via Spotify API, preserving the original "Date Added" timestamps and playlist metadata.
-   **Dual Provider (Vertex AI / AI Studio):** Supports **Google Cloud Vertex AI** (utilizing $300 in free GCP trial credits) and **Google AI Studio** (via free API Key — `gemini-4-hydrogen` is available on the Free Tier). Automatic cascading fallback switches models seamlessly on outages or rate limits.
-   **Resilient Bilingual Search:** Searches tracks in both Latin and Cyrillic with fixed transliteration, an anti-cover/tribute filter, chunked batching (25 requests per batch to avoid Spotify 502 spikes), and a built-in search time guard to stay safely within Google Apps Script's 6-minute execution limit.

## Project Structure (Modular Architecture)

The project is divided into four files for convenience and to avoid code duplication:

1.  ### `AI_General.gs` (The Engine)
    The central file containing API routing (`VERTEX_AI` / `AI_STUDIO`), Gemini 4 (`MAIN_MODELS` / `FAST_MODELS`) and Nano Banana 2.1 cascading logic, cover art generation, and chunked "bulletproof" Spotify track search algorithms.
2.  ### `AI_Playlist.gs` (Daily "Discovery" Playlist)
    Compacts and analyzes your saved tracks (`SavedTracks.json`) to save 5–10× on input tokens and automatically generates a daily mix of new music based on your "Taste DNA" and calendar holidays. Can run automatically via a trigger.
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

### Part 2: Gathering IDs and AI Provider Setup

1.  **Spotify Playlist ID:** (Right-click your playlist -> Share -> Copy link). The ID is the characters after `playlist/`. You will need it for the target playlist variables.
2.  **Choose & Configure Your AI Provider:**

    *   **Option A (Recommended — Vertex AI with $300 Trial Credits):**
        1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
        2. Note down your GCP **Project ID**.
        3. Open your Google Apps Script **Project Settings** (⚙️) -> **Google Cloud Platform (GCP) Project** -> Click **Change project** and enter your GCP Project ID.

    *   **Option B (Free AI Studio API Key):**
        1. Create a free API key at **[Google AI Studio](https://aistudio.google.com/)**.
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
2. Add the required properties based on your chosen provider:
    *   If using **Vertex AI**:
        *   Property: `GCP_PROJECT_ID`
        *   Value: your Google Cloud Project ID.
    *   If using **AI Studio**:
        *   Property: `GEMINI_API_KEY`
        *   Value: your Google Gemini API key.
3. Open `AI_General.gs` and set the execution mode in `GLOBAL_AI_CONFIG.PROVIDER`:
    *   `PROVIDER: 'VERTEX_AI'` — for routing requests through GCP Vertex AI (utilizing trial credits).
    *   `PROVIDER: 'AI_STUDIO'` — for routing requests through the Gemini API Key (`x-goog-api-key` header).
4. Save properties and script files.

---

### Part 5: Running and Automating

*   **Automation (Triggers):** Go to Triggers (⏰). Create a trigger for `generateAndCreateSpotifyPlaylist` (e.g., daily at night). For cleaning up listened tracks, add a trigger for `cleanUpPlaylist` (e.g., every hour). *The system is fully protected by mutexes — if generation and cleanup overlap, they will not break each other.*
*   **Manual Run:** Open the desired file (e.g., `AI_Generator.gs`), select the main function at the top of the screen, and click **"Run"**.
