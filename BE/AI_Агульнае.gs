/**
 * @OnlyCurrentDoc
 * AI_Агульнае - Цэнтральнае сховішча глабальных налад і агульных функцый AI/Пошуку.
 */

const GLOBAL_AI_CONFIG = {
  // Выбар правайдэра: 'VERTEX_AI' або 'AI_STUDIO'
  PROVIDER: 'VERTEX_AI', 
  
  VERTEX_AI: {
    PROJECT_ID: PropertiesService.getScriptProperties().getProperty('GCP_PROJECT_ID'),
    LOCATION: 'global'
  },

  TEXT: {
    // Асноўны каскад для генерацыі спісаў трэкаў
    MAIN_MODELS: [
      'gemini-4-hydrogen',
      'gemini-4-neon',
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite'
    ],
    // Хуткі каскад для дапаможных задач (промпт для вокладкі)
    FAST_MODELS: [
      'gemini-4-hydrogen',
      'gemini-3.8-flash',
      'gemini-3.5-flash-lite'
    ]
  },

  IMAGE: {
    ENABLED: true,
    GEMINI_MODELS_PRIORITY: [
      'gemini-nano-banana-2.1',
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-lite-image',
      'gemini-3-pro-image'
    ], 
    POLLINATIONS_MODEL: 'flux' 
  }  
};

function getAuthToken_() {
  return ScriptApp.getOAuthToken();
}

function getGeminiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key && GLOBAL_AI_CONFIG.PROVIDER === 'AI_STUDIO') {
    throw new Error("API ключ 'GEMINI_API_KEY' не знойдзены ва ўласцівасцях скрыпта.");
  }
  return key;
}

function getVertexHost_() {
  const loc = GLOBAL_AI_CONFIG.VERTEX_AI.LOCATION;
  if (!loc || loc === 'global') {
    return 'https://aiplatform.googleapis.com';
  }
  return `https://${loc}-aiplatform.googleapis.com`;
}

// =========================================================================
// 2. РУХАВІК ТЭКСТАВАГА AI
// =========================================================================

/**
 * Выклік тэкставага API Gemini (generateContent)
 * @param {string} promptText - тэкст запыту карыстальніка
 * @param {boolean|Object} optionsOrFast - boolean (хуткі рэжым) або аб'ект { fast, systemInstruction, responseMimeType, responseSchema, thinkingLevel }
 */
function callGeminiTextAPI(promptText, optionsOrFast = false) {
  if (typeof promptText !== 'string' || !promptText.trim()) {
    throw new Error('❌ У callGeminiTextAPI перададзены пусты або некарэктны promptText.');
  }

  const opts = typeof optionsOrFast === 'boolean'
    ? { fast: optionsOrFast }
    : (optionsOrFast || {});

  const isFast = Boolean(opts.fast);
  const responseMimeType = opts.responseMimeType || 'application/json';
  const thinkingLevel = opts.thinkingLevel || (isFast ? 'LOW' : 'MEDIUM');
  const modelsList = isFast
    ? GLOBAL_AI_CONFIG.TEXT.FAST_MODELS
    : GLOBAL_AI_CONFIG.TEXT.MAIN_MODELS;

  const generationConfig = {
    responseMimeType: responseMimeType,
    thinkingConfig: { thinkingLevel: thinkingLevel }
  };

  if (responseMimeType === 'application/json') {
    generationConfig.responseSchema = opts.responseSchema || {
      type: 'ARRAY',
      items: { type: 'STRING' }
    };
  }

  let aiResponse = null;
  let usedModel = '';

  for (const modelName of modelsList) {
    Logger.log(`🔄 Спроба выкліку "${modelName}" (${GLOBAL_AI_CONFIG.PROVIDER}, thinking=${thinkingLevel})...`);

    const payload = {
      contents: [{
        role: 'user',
        parts: [{ text: promptText }]
      }],
      generationConfig: generationConfig
    };

    if (opts.systemInstruction) {
      payload.systemInstruction = {
        parts: [{ text: opts.systemInstruction }]
      };
    }

    let url, options;
    if (GLOBAL_AI_CONFIG.PROVIDER === 'VERTEX_AI') {
      const host = getVertexHost_();
      const loc = GLOBAL_AI_CONFIG.VERTEX_AI.LOCATION || 'global';
      const projectId = GLOBAL_AI_CONFIG.VERTEX_AI.PROJECT_ID;
      
      url = `${host}/v1/projects/${projectId}/locations/${loc}/publishers/google/models/${modelName}:generateContent`;

      options = { 
        'method': 'post', 
        'contentType': 'application/json', 
        'headers': { 'Authorization': 'Bearer ' + getAuthToken_() }, 
        'payload': JSON.stringify(payload), 
        'muteHttpExceptions': true 
      };
    } else {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

      options = { 
        'method': 'post', 
        'contentType': 'application/json', 
        'headers': { 'x-goog-api-key': getGeminiKey_() },
        'payload': JSON.stringify(payload), 
        'muteHttpExceptions': true 
      };
    }

    try {
      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const content = response.getContentText();
      
      if (responseCode === 200) {
        const json = JSON.parse(content);
        const parts = json.candidates?.[0]?.content?.parts || [];
        const text = parts
          .filter(p => p.text && !p.thought)
          .map(p => p.text)
          .join('')
          .trim();

        if (text) {
          aiResponse = text;
          usedModel = modelName;
          Logger.log(`✅ Мадэль "${modelName}" паспяхова згенеравала адказ.`);
          break;
        }
      } else {
        Logger.log(`⚠️ Мадэль "${modelName}" недаступная (Код: ${responseCode}). Адказ API: ${content.substring(0, 300)}`);
        Utilities.sleep(1000);
      }
    } catch (e) {
      Logger.log(`⚠️ Памылка выканання запыту да мадэлі "${modelName}": ${e.toString()}`);
    }
  }

  if (!aiResponse) throw new Error('❌ Усе тэкставыя мадэлі недаступныя.');
  return { responseText: aiResponse, model: usedModel };
}


function parseAiResponse(rawResponse) {
  let cleanedJson = rawResponse.replace(/^[\s\S]*?\[/, '[').replace(/\][\s\S]*$/, ']');
  try {
    let tracks = JSON.parse(cleanedJson);
    if (!Array.isArray(tracks)) throw new Error("Гэта не масіў");
    return tracks.filter(item => typeof item === 'string' && item.trim().length > 0);
  } catch (e) {
    Logger.log(`❌ Памылка парсінгу адказу: ${e.message}\nСыры адказ: ${rawResponse}`);
    return [];
  }
}

// =========================================================================
// 3. РУХАВІК ВЫЯЎ (ВОКЛАДКІ)
// =========================================================================

function generateAndApplyCover(playlistId, tracks) {
  if (!GLOBAL_AI_CONFIG.IMAGE.ENABLED) return;
  
  Logger.log('🎨 Пачатак генерацыі вокладкі...');
  const prompt = buildImagePrompt_(tracks);
  if (!prompt) return;

  let coverBase64 = callGeminiImageGen_(prompt);
  
  if (!coverBase64) {
    Logger.log('⚠️ Пераход на рэзервовы генератар выяў (Pollinations)...');
    coverBase64 = callPollinationsImageGen_(prompt);
  }

  if (coverBase64) {
    Logger.log('⏳ Загрузка вокладкі ў Spotify...');
    try {
      SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${playlistId}/images`, coverBase64);
      Logger.log('✅ Запыт на абнаўленне вокладкі адпраўлены.');
    } catch (e) {
      Logger.log(`❌ Памылка выканання запыту вокладкі: ${e.toString()}`);
    }
  }
}

function buildImagePrompt_(tracks) {
  const trackSample = Selector.sliceRandom(tracks, 50)
    .map(t => `${t.artists[0].name} - ${t.name}`)
    .join('\n');

  const systemInstruction = `## Function
Generate one text-to-image prompt for a square 1:1 playlist cover artwork based on the lyrical themes, cultural context, and emotional atmosphere of the input tracklist. Target image model: Gemini Nano Banana 2.1.

## Visual Translation Criteria
- **Semantic metaphor:** Depict a cohesive surreal, symbolic, or abstract scene that translates the shared emotional narrative and cultural mood of the songs into imagery.
- **Artistic direction:** Select the single visual medium, style, lighting, and color palette that best amplify the mood. Optional inspiration (free to choose any other fitting medium or palette):
  - Styles: Surrealism, Vintage 70s Sci-Fi Illustration, Minimalist Graphic Design, Abstract Expressionism, Cinematic 35mm Photography, Cyberpunk, Japanese Woodblock Print, Glitch Art, Classic Oil Painting, Dark Fantasy, Pop Art.
  - Palettes: Neon and High Contrast, Muted Autumn Earth Tones, Cold Melancholic Blues, Monochrome with One Piercing Accent, Pastel Watercolors, Dark and Moody, Psychedelic Acid Colors.
- **Composition:** Describe an edge-to-edge, full-bleed square painting, illustration, or photograph filling the entire frame directly.

## Semantic Negative Prompting (CRITICAL for Nano Banana 2.1)
- Describe ONLY what is positively visible in the scene. Never put negative keyword lists or negated forbidden objects (such as "no text", "no typography", "no instruments", "no vinyl", "no rocks", "no borders") inside the output prompt.
- Achieve clean results purely through positive visual description:
  - Keep surfaces clean, unlettered, and purely graphic/pictorial.
  - Use strictly non-musical visual metaphors (landscapes, light, architecture, figures, surreal objects).
  - For rock or metal playlists, translate energy through atmosphere, light, motion, or abstract forms instead of geological stones, boulders, or mountains.

## Output Specification
- Exactly one continuous paragraph in English, strictly under 140 words.
- Raw image-generation prompt only: no markdown, no labels, no preamble.`;

  const userPrompt = `## Playlist Tracklist (50-track sample)
${trackSample}

Based on the themes, cultural context, and emotional mood of the tracklist above, write one English text-to-image prompt (single paragraph, under 140 words) describing a full-bleed square visual artwork using purely positive semantic phrasing, with clean unlettered surfaces, non-musical metaphors, and zero negative-keyword lists.`;
  
  try {
    const result = callGeminiTextAPI(userPrompt, {
      fast: true,
      systemInstruction: systemInstruction,
      responseMimeType: 'text/plain',
      thinkingLevel: 'LOW'
    });
    const prompt = result.responseText
      .replace(/^```[\w]*\s*/i, '')
      .replace(/```$/i, '')
      .trim();
    
    Logger.log(`✅ Промпт для вокладкі створаны: "${prompt.substring(0, 150)}..."`);
    return prompt;
  } catch (e) {
    Logger.log(`⚠️ Не ўдалося стварыць промпт для выявы: ${e.toString()}`);
    return null;
  }
}

function callGeminiImageGen_(prompt) {
  for (const modelName of GLOBAL_AI_CONFIG.IMAGE.GEMINI_MODELS_PRIORITY) {
    Logger.log(`🎨 Спроба генерацыі выявы праз ${GLOBAL_AI_CONFIG.PROVIDER} (${modelName})...`);

    const generationConfig = {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: '1:1', imageSize: '1K' }
    };
    if (modelName === 'gemini-nano-banana-2.1') {
      generationConfig.thinkingConfig = { thinkingLevel: 'MINIMAL' };
    }

    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: generationConfig
    };

    let url, options;
    if (GLOBAL_AI_CONFIG.PROVIDER === 'VERTEX_AI') {
      const host = getVertexHost_();
      const loc = GLOBAL_AI_CONFIG.VERTEX_AI.LOCATION || 'global';
      const projectId = GLOBAL_AI_CONFIG.VERTEX_AI.PROJECT_ID;
      
      url = `${host}/v1/projects/${projectId}/locations/${loc}/publishers/google/models/${modelName}:generateContent`;
      options = { 
        'method': 'post', 
        'contentType': 'application/json', 
        'headers': { 'Authorization': 'Bearer ' + getAuthToken_() },
        'payload': JSON.stringify(payload), 
        'muteHttpExceptions': true 
      };
    } else {
      url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
      options = { 
        'method': 'post', 
        'contentType': 'application/json', 
        'headers': { 'x-goog-api-key': getGeminiKey_() },
        'payload': JSON.stringify(payload), 
        'muteHttpExceptions': true 
      };
    }

    try {
      const response = UrlFetchApp.fetch(url, options);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();
      
      if (responseCode === 200) {
        const json = JSON.parse(responseText);
        const parts = json.candidates?.[0]?.content?.parts || [];
        const imagePart = parts.find(p => p.inlineData && p.inlineData.data);

        if (imagePart) {
          const rawBase64 = imagePart.inlineData.data;
          const mimeType = imagePart.inlineData.mimeType || 'image/png';
          let blob = Utilities.newBlob(Utilities.base64Decode(rawBase64), mimeType).getAs('image/jpeg');
          let base64Payload = Utilities.base64Encode(blob.getBytes());
          let payloadSizeKB = Math.round(base64Payload.length / 1024);
          
          Logger.log(`✅ Выява створана. Вага: ${payloadSizeKB} KB (Ліміт Spotify: 250 KB)`);
          
          if (payloadSizeKB > 245) {
            Logger.log(`⚠️ Пайлоўд занадта тоўсты. Запуск Google Drive Compression Pipeline...`);
            const compressedBlob = compressBlobViaDrive_(blob);
            if (compressedBlob) {
              const compressedBase64 = Utilities.base64Encode(compressedBlob.getBytes());
              const newSizeKB = Math.round(compressedBase64.length / 1024);
              Logger.log(`✅ Кампрэсія паспяховая. Новы вага: ${newSizeKB} KB`);
              if (newSizeKB > 245) {
                Logger.log('🛑 Пасля кампрэсіі выява занадта вялікая. Адхілена.');
                continue;
              }
              return compressedBase64;
            } else {
              Logger.log('❌ Не ўдалося сціснуць малюнак. Пераход да наступнай мадэлі.');
              continue;
            }
          }
          return base64Payload;
        }
      } else {
        Logger.log(`🛑 ПАМЫЛКА API (Код ${responseCode}): ${responseText.substring(0, 300)}`);
        Utilities.sleep(1500);
      }
    } catch (e) {
      Logger.log(`❌ Крытычная памылка генерацыі выявы: ${e.toString()}`);
    }
  }
  return null; 
}

function compressBlobViaDrive_(originalBlob) {
  let tempFile = null;
  try {
    tempFile = DriveApp.createFile(originalBlob.setName(`goofy_temp_cover_${Date.now()}.jpg`));
    tempFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const thumbnailUrl = `https://drive.google.com/thumbnail?id=${tempFile.getId()}&sz=w512-h512-c`;
    const response = UrlFetchApp.fetch(thumbnailUrl, { muteHttpExceptions: true });
    
    if (response.getResponseCode() === 200) {
      return response.getBlob().getAs('image/jpeg');
    }
  } catch (e) {
    Logger.log(`❌ Памылка кампрэсіі: ${e.message}`);
  } finally {
    if (tempFile) {
      try { tempFile.setTrashed(true); } catch(e) {}
    }
  }
  return null;
}

function callPollinationsImageGen_(prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&model=${GLOBAL_AI_CONFIG.IMAGE.POLLINATIONS_MODEL}&seed=${Math.floor(Math.random() * 1000000)}&nologo=true`;
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      const base64Payload = Utilities.base64Encode(response.getBlob().getBytes());
      if (Math.round(base64Payload.length / 1024) <= 245) return base64Payload;
    }
  } catch (e) {}
  return null;
}

// =========================================================================
// 4. БРОНЕБІТНЫ ПОШУК SPOTIFY
// =========================================================================

function executeSmartSearch(rawAiTracks) {
  if (!rawAiTracks || rawAiTracks.length === 0) return [];
  const searchStartMs = Date.now();
  const MAX_SEARCH_MS = 120000;
  let allFoundTracks = [], notFoundQueries = [];

  Logger.log('\n--- УЗРОВЕНЬ 1: Пошук па арыгінале ---');
  let stage1Results = fetchSpotifyTracksCustom_(rawAiTracks);
  let stage2Queries = [], stage2Originals = [];

  for (let i = 0; i < rawAiTracks.length; i++) {
    let match = findBestMatchCustom_(rawAiTracks[i], stage1Results[i]);
    if (match) {
      allFoundTracks.push(match);
      Logger.log(`✅ [Узр 1] Знайшлі: "${rawAiTracks[i]}" -> ${match.artists[0].name} - ${match.name}`);
    } else {
      stage2Originals.push(rawAiTracks[i]);
      stage2Queries.push(translitCyrillicToLatinCustom_(rawAiTracks[i].toLowerCase()));
    }
  }

  if (stage2Queries.length > 0 && (Date.now() - searchStartMs) < MAX_SEARCH_MS) {
    Logger.log(`\n--- УЗРОВЕНЬ 2: Транслітарацыя (${stage2Queries.length} трэкаў) ---`);
    let stage2Results = fetchSpotifyTracksCustom_(stage2Queries);
    let stage3Originals = [], stage3Queries = [];

    for (let i = 0; i < stage2Queries.length; i++) {
      let match = findBestMatchCustom_(stage2Queries[i], stage2Results[i], stage2Originals[i]);
      if (match) {
        allFoundTracks.push(match);
        Logger.log(`✅ [Узр 2] Знайшлі: "$
