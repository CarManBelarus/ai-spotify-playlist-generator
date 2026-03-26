# AI Spotify Playlist Generator

A Google Apps Script project that leverages **Google's Gemini AI** to generate personalized Spotify playlists, **Hugging Face** for unique cover art, and the **FlowSort** algorithm for perfect track sequencing.

This repository contains a set of add-on scripts for the [Goofy library](https://chimildic.github.io/goofy/) that enable advanced automation and smart playlist creation.

## Key Features

-   **Smart Daily Updates:** Adds fresh recommendations to the top of your playlist daily.
-   **Multi-Model AI Fallback:** Uses a robust system: if the primary model (Gemini Pro) is overloaded, it automatically switches to a backup (Flash).
-   **Premium Cover Art:** Generates images via top-tier **FLUX.1** models (with fallback to Stable Diffusion 3 and XL).
-   **Bilingual Search:** Understands and searches tracks in both Latin and Cyrillic.
-   **DJ Sorting (FlowSort):** Sequences tracks by tempo (BPM) and key (Camelot) for seamless transitions.

## Project Structure (Modular Architecture)

The project is divided into three files for convenience and to avoid code duplication:

1.  ### `AI_General.gs` (The Engine)
    The central file containing all API keys, model settings, Gemini AI logic, cover art generation, and "bulletproof" Spotify track search algorithms.
2.  ### `AI_Playlist.gs` (Daily "Discovery" Playlist)
    Analyzes your saved tracks (`SavedTracks.json`) and automatically generates a daily mix of new music based on your "Taste DNA" and calendar holidays. Can run automatically via a trigger.
3.  ### `AI_Generator.gs` (On-Demand Generator)
    A tool for creating thematic playlists via text prompts (e.g., "Music for a night road trip"). Run this manually when you need a specific mix.

---

## Installation and Setup Guide

This guide will walk you through setting up the project from scratch.

### Prerequisites
-   A Google Account (for Google Apps Script).
-   A Spotify Account (Premium recommended).
-   A Hugging Face Account (free, for cover art).

---

### Part 1: Initial Goofy Library Setup

1.  **Get the Belarusian Goofy version (Optional but recommended for stability).**
    -   **[Download BE Goofy library](https://github.com/CarManBelarus/goofy)**
    Copy the contents of `library.js` and `config.gs`.

2.  **Follow the official Goofy installation guide.**
    -   **[Official Goofy Installation Guide](https://chimildic.github.io/goofy/#/install)**
    Complete all steps, including authorization.

3.  **Wait for the cache to build.** After Goofy setup, it takes time to create the `SavedTracks.json` file in your Google Drive. This is crucial for taste analysis.

---

### Part 2: Gathering IDs and API Keys

1.  **Spotify Playlist ID:** (Right-click your playlist -> Share -> Copy link). The ID is the characters after `playlist/`.
2.  **Google Gemini API Key:** Create a free key at **[Google AI Studio](https://aistudio.google.com/)**.
3.  **Hugging Face API Key + Access (IMPORTANT):**
    *   Create a token in **[Hugging Face Settings](https://huggingface.co/settings/tokens)** (type `read`).
    *   **⚠️ CRITICAL STEP:** Visit the links below and click **"Agree and access repository"**:
        *   [FLUX.1-dev](https://huggingface.co/black-forest-labs/FLUX.1-dev)
        *   [FLUX.1-schnell](https://huggingface.co/black-forest-labs/FLUX.1-schnell)

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

---

### Part 4: Final Configuration

1. Go to **Project Settings** (⚙️) -> **Script Properties**.
2. Add two keys:
    *   `GEMINI_API_KEY`: your Google Gemini key.
    *   `HUGGINGFACE_API_KEY`: your Hugging Face token.
3. Save properties.

*(Recommendation):* Open `config.gs` and add the line `UserProperties.setProperty('MIN_DICE_RATING', '0.70');` inside the `setProperties()` function to improve search accuracy.

---

### Part 5: Running and Automating

*   **Automation:** Go to Triggers (⏰). Create a trigger for `generateAndCreateSpotifyPlaylist` (e.g., daily at night). For cleaning up listened tracks, add a trigger for `cleanUpPlaylist` (e.g., every hour).
*   **Manual Run:** Open `AI_Generator.gs`, set your theme in `TOPIC_PROMPT`, select the `generateCustomPlaylist` function at the top, and click **"Run"**.
