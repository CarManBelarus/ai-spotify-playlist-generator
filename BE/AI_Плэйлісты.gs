/**
 * @OnlyCurrentDoc
 * Галоўны файл для працы з Gemini AI для стварэння плэйлістоў Spotify.
 * ВЕРСІЯ: "Golden Release" (Multi-Model Gemini + FLUX/SD3 Cover Art)
 * 
 * Гэты скрыпт:
 * 1. Аналізуе вашу бібліятэку (SavedTracks.json).
 * 2. Генекуе рэкамендацыі праз Google Gemini (з рэзервовымі мадэлямі).
 * 3. Шукае трэкі ў Spotify (з падтрымкай кірыліцы).
 * 4. Стварае AI-вокладку праз Hugging Face (FLUX/SD3).
 */

// ===============================================================
//                           КАНФІГУРАЦЫЯ
// ===============================================================

const AI_CONFIG = {
  // === АБАВЯЗКОВЫЯ НАЛАДЫ ===
  
  // ID плэйліста Spotify, які будзе абнаўляцца.
  // Вы можаце ўзяць яго з URL плэйліста: open.spotify.com/playlist/ВАШ_ID
  SPOTIFY_PLAYLIST_ID: 'INSERT_YOUR_PLAYLIST_ID_HERE', 

  // === НАЛАДЫ GEMINI (MULTI-MODEL FALLBACK) ===
  // Спіс мадэляў па прыярытэце. Калі першая занятая (503) або недаступная, 
  // скрыпт аўтаматычна паспрабуе наступную.
  GEMINI_MODELS_PRIORITY: [
    'gemini-2.5-pro',          // 1. "Мозг": Лепшая якасць і эрудыцыя
    'gemini-flash-latest',     // 2. "Хуткасць": Актуальная версія Flash (рэзерв)
    'gemini-flash-lite-latest' // 3. "Лёгкасць": Самая эканамічная мадэль (апошні шанец)
  ],

  // Колькасць трэкаў для аналізу з вашай бібліятэкі (каб не перавысіць ліміт токенаў)
  TRACK_SAMPLE_SIZE_FOR_AI: 500,

  // Максімальны памер плэйліста перад выдаленнем старых трэкаў.
  MAX_PLAYLIST_SIZE: 500, 

  // === НАЛАДЫ ГЕНЕРАЦЫІ ВОКЛАДКІ (ПРАЗ HUGGING FACE) ===
  IMAGE_GENERATION: {
      ENABLED: true,
      
      // "Залаты спіс" правераных мадэляў. Скрыпт будзе спрабаваць іх па чарзе.
      AVAILABLE_MODELS: {
        // 1. Топ па якасці і дэталізацыі (~10-15 сек). Патрабуе прыняцця ліцэнзіі на HF.
        FLUX_DEV: 'black-forest-labs/FLUX.1-dev', 
        
        // 2. Топ па хуткасці (~2-3 сек).
        FLUX_SCHNELL: 'black-forest-labs/FLUX.1-schnell', 
        
        // 3. Іншы мастацкі стыль (Stable Diffusion 3).
        SD3_MEDIUM: 'stabilityai/stable-diffusion-3-medium-diffusers',
        
        // 4. Надзейная класіка (заўсёды працуе без дадатковых ліцэнзій).
        SDXL_BASE: 'stabilityai/stable-diffusion-xl-base-1.0'
      }
  },

  // Шаблон назвы плэйліста. {date} замяняецца на бягучую дату.
  PLAYLIST_NAME_TEMPLATE: 'AI Плэйліст ад {date}',
  
  // Колькасць дзён, пасля якіх праслуханыя трэкі выдаляюцца (для функцыі cleanUpPlaylist)
  CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS: 60
};

// ===============================================================
//                АСНОЎНАЯ ФУНКЦЫЯ ГЕНЕРАЦЫІ ПЛЭЙЛІСТА
// ===============================================================

/**
 * Запускае поўны цыкл: Аналіз -> Генерацыя спісу -> Пошук -> Абнаўленне -> Вокладка.
 */
function generateAndCreateSpotifyPlaylist() {
  try {
    Logger.log('Пачатак працэсу стварэння AI плэйліста...');
    const geminiApiKey = getGeminiApiKey_();
    
    // 1. Падрыхтоўка дадзеных
    const randomTracksJsonString = prepareTracksForPrompt_();
    if (!randomTracksJsonString) return; // Спыняем, калі няма дадзеных

    Logger.log('Стварэнне тэксту запыту (промпту) для Gemini AI...');
    const promptText = createTrackRecommendationPrompt_(randomTracksJsonString);

    // 2. Выклік AI з цыклам "выратавання" (Fallback Loop)
    let aiResponseJsonString = null;
    let usedModel = '';

    for (const modelName of AI_CONFIG.GEMINI_MODELS_PRIORITY) {
      Logger.log(`🔄 Спроба выкліку мадэлі: "${modelName}"...`);
      aiResponseJsonString = callGeminiApi_(geminiApiKey, modelName, promptText);
      
      if (aiResponseJsonString) {
        Logger.log(`✅ Мадэль "${modelName}" паспяхова адказала.`);
        usedModel = modelName;
        break; 
      } else {
        Logger.log(`⚠️ Мадэль "${modelName}" не адказала. Пераход да наступнай...`);
        Utilities.sleep(1000); // Паўза перад наступнай спробай
      }
    }

    if (!aiResponseJsonString) throw new Error('❌ Усе мадэлі Gemini недаступныя (503/Error).');

    // 3. Апрацоўка адказу
    Logger.log('Парсінг JSON-адказу ад AI...');
    const tracksToSearch = parseAiResponse_(aiResponseJsonString);
    Logger.log(`AI (${usedModel}) рэкамендаваў ${tracksToSearch.length} трэкаў для пошуку.`);

    if (tracksToSearch.length === 0) {
        Logger.log('Спіс трэкаў пусты. Спыненне.');
        return;
    }

    // ===============================================================
    //           РАЗУМНЫ ДВУХЭТАПНЫ ПОШУК
    // ===============================================================

    Logger.log('Падрыхтоўка запытаў для пошуку...');
    const initialLatinQueries = [...new Set(tracksToSearch.map(track => normalizeTrackQuery_(track)).filter(q => q))];

    // --- ЭТАП 1: Пошук па лацінцы ---
    Logger.log(`[Этап 1] Пошук ${initialLatinQueries.length} трэкаў па лацінскіх назвах...`);
    let foundSpotifyTracks = Search.multisearchTracks(initialLatinQueries);
    
    // Вызначаем, што не знайшлі
    const foundTrackNames = new Set(foundSpotifyTracks.map(t => `${t.artists[0].name} ${t.name}`.toLowerCase()));
    const notFoundQueries = initialLatinQueries.filter(query => {
        return !Array.from(foundTrackNames).some(found => found.includes(query.split(' ')[1]));
    });

    // --- ЭТАП 2: Пошук па кірыліцы (для мясцовай музыкі) ---
    if (notFoundQueries.length > 0) {
      Logger.log(`${notFoundQueries.length} трэкаў не знойдзена. Спроба пошуку па кірылічных варыянтах...`);
      const cyrillicQueries = [];
      notFoundQueries.forEach(query => {
        const cyrillicGuess = reverseTransliterate_(query);
        if (cyrillicGuess) {
          cyrillicQueries.push(cyrillicGuess);
          Logger.log(`[Дадатковы запыт] "${query}" -> "${cyrillicGuess}"`);
        }
      });

      if (cyrillicQueries.length > 0) {
        const additionalFoundTracks = Search.multisearchTracks(cyrillicQueries);
        Logger.log(`[Этап 2] Дадаткова знойдзена ${additionalFoundTracks.length} трэкаў.`);
        foundSpotifyTracks.push(...additionalFoundTracks);
      }
    }

    // Выдаленне дублікатаў у выніках пошуку
    Filter.dedupTracks(foundSpotifyTracks);
    Logger.log(`Усяго знойдзена ${foundSpotifyTracks.length} унікальных трэкаў.`);

    if (foundSpotifyTracks.length === 0) {
      Logger.log('Няма трэкаў для дадавання на Spotify.');
      return;
    }

    // 4. Абнаўленне плэйліста
    updatePlaylistIncrementally_(foundSpotifyTracks);
    Logger.log('🎉 Працэс паспяхова завершаны.');

  } catch (error) {
    Logger.log(`КРЫТЫЧНАЯ ПАМЫЛКА: ${error.toString()}`);
    Logger.log(`Стэк: ${error.stack}`);
  }
}

// ===============================================================
//         АБНАЎЛЕННЕ ПЛЭЙЛІСТА І ВОКЛАДКІ
// ===============================================================

function updatePlaylistIncrementally_(foundSpotifyTracks) {
  Logger.log(`Атрыманне існуючых трэкаў з плэйліста...`);
  const existingPlaylistTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  
  // Пакідаем толькі тыя, якіх яшчэ няма ў плэйлісце
  let newUniqueTracks = Selector.sliceCopy(foundSpotifyTracks);
  Filter.removeTracks(newUniqueTracks, existingPlaylistTracks);
  const newTracksCount = newUniqueTracks.length;
  Logger.log(`Знойдзена ${newTracksCount} новых, унікальных трэкаў для дадавання.`);

  if (newTracksCount > 0) {
    Logger.log(`Пачатак папарцыйнага дадання ${newTracksCount} трэкаў...`);
    const CHUNK_SIZE = 100; // Абмежаванне API Spotify
    for (let i = 0; i < newTracksCount; i += CHUNK_SIZE) {
      const chunk = newUniqueTracks.slice(i, i + CHUNK_SIZE);
      Logger.log(`Даданне часткі з ${chunk.length} трэкаў...`);
      try {
        Playlist.saveWithAppend({
          id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
          tracks: chunk,
          position: 'begin' // Новыя трэкі ў пачатак
        });
        if (newTracksCount > CHUNK_SIZE) Utilities.sleep(2000); // Паўза, каб не перагрузіць API
      } catch (e) {
        Logger.log(`ПАМЫЛКА дадання часткі: ${e}`);
      }
    }
    Logger.log('Папарцыйнае даданне завершана.');
  }
  
  const finalTotalTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID).length;
  updatePlaylistDetailsAndCover_(newTracksCount, finalTotalTracks);
  trimPlaylistIfNeeded_();
}

function updatePlaylistDetailsAndCover_(addedCount, totalCount) {
    Logger.log('Спроба згенераваць і апрацаваць новую вокладку...');
    let coverImageBase64 = null;
    let tempFile = null;
    
    try {
        // Генерацыя вокладкі
        coverImageBase64 = generatePlaylistCover_();
        
        if (coverImageBase64) {
            // Апрацоўка памеру (Resize) праз знешні сэрвіс (для гарантыі < 256KB)
            const imageBlob = Utilities.newBlob(Utilities.base64Decode(coverImageBase64), 'image/jpeg', 'temp_cover.jpg');
            tempFile = DriveApp.createFile(imageBlob);
            tempFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            
            const imageUrlForResize = `https://drive.google.com/uc?id=${tempFile.getId()}`;
            const resizeServiceUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrlForResize)}&w=600&h=600&q=90&output=jpg`;
            
            const resizedResponse = UrlFetchApp.fetch(resizeServiceUrl, { 'muteHttpExceptions': true });
            
            if (resizedResponse.getResponseCode() === 200) {
                coverImageBase64 = Utilities.base64Encode(resizedResponse.getBlob().getBytes());
                Logger.log(`✅ Малюнак паспяхова паменшаны.`);
            }
        }
    } catch (e) {
        Logger.log(`⚠️ Памылка апрацоўкі вокладкі: ${e}`);
    } finally {
        if (tempFile) {
            try { tempFile.setTrashed(true); } catch (e) {}
        }
    }

    const playlistName = AI_CONFIG.PLAYLIST_NAME_TEMPLATE.replace('{date}', new Date().toLocaleDateString('be-BY'));
    const formattedDateTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMMM yyyy, HH:mm');

    const payload = {
      name: playlistName,
      description: `Апошняе абнаўленне: ${formattedDateTime}. Дададзена: ${addedCount} новых. Агулам: ${totalCount}.`
    };

    Logger.log(`Абнаўленне назвы і апісання...`);
    try {
        SpotifyRequest.put(`${API_BASE_URL}/playlists/${AI_CONFIG.SPOTIFY_PLAYLIST_ID}`, payload);
        Logger.log('✅ Назва і апісанне абноўлены.');
    } catch (e) { Logger.log(`⚠️ Памылка метададзеных: ${e}`); }

    if (coverImageBase64) {
        Logger.log('Загрузка новай вокладкі ў Spotify...');
        try {
            SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${AI_CONFIG.SPOTIFY_PLAYLIST_ID}/images`, coverImageBase64);
            Logger.log('✅ Вокладка паспяхова загружана.');
        } catch (e) { Logger.log(`⚠️ Памылка загрузкі вокладкі: ${e}`); }
    }
}

function trimPlaylistIfNeeded_() {
  Logger.log('Праверка памеру плэйліста...');
  const currentTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  
  if (currentTracks.length > AI_CONFIG.MAX_PLAYLIST_SIZE) {
    const trimmedTracks = currentTracks.slice(0, AI_CONFIG.MAX_PLAYLIST_SIZE);
    Playlist.saveWithReplace({
      id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
      tracks: trimmedTracks
    });
    Logger.log(`✅ Плэйліст абрэзаны да ${AI_CONFIG.MAX_PLAYLIST_SIZE} трэкаў.`);
  } else {
    Logger.log('Абразанне не патрабуецца.');
  }
}

// ===============================================================
//                     СТВАРЭННЕ ПРОМПТАЎ ДЛЯ AI
// ===============================================================

function prepareTracksForPrompt_() {
  Logger.log('Чытанне SavedTracks.json...');
  const allTracks = Cache.read('SavedTracks.json');
  if (!allTracks || allTracks.length === 0) {
    Logger.log('ПАМЫЛКА: SavedTracks.json пусты. Праверце наладу бібліятэкі Goofy.');
    return null;
  }
  const randomTracks = Selector.sliceRandom(allTracks, AI_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
  return JSON.stringify(randomTracks);
}

function createTrackRecommendationPrompt_(tracksJsonString) {
  const today = new Date().toLocaleDateString('be-BY', { year: 'numeric', month: 'long', day: 'numeric' });
  return `
[Роля]: Ты — музычны куратар і даследчык.
[Кантэкст]: Сёння ${today}. Прааналізуй мае густы з дадзеных ніжэй.
[Уваходныя даныя]: \`\`\`json ${tracksJsonString} \`\`\`
[Задача]: Згенеруй спіс з 200 трэкаў для адкрыцця новай музыкі.
[Правілы]:
- 70% адпаведнасць густам, 30% эксперыменты (сумежныя жанры, іншыя краіны).
- 30% лакальная сцэна (Беларусь), калі гэта дарэчы ў кантэксце жанраў.
- Выключыць: Рускамоўныя песні расейскіх выканаўцаў.
[Фармат]: Вярні ТОЛЬКІ JSON-масіў радкоў у фармаце "Artist - Track". Ніякіх тлумачэнняў.
[Прыклад]: ["Molchat Doma - Sudno", "Akute - Zorka", "The Cure - A Forest"]
`;
}

/**
 * [ФІНАЛЬНАЯ ВЕРСІЯ] Генерацыя вокладкі з прыярытэтам якасці (FLUX DEV).
 */
function generatePlaylistCover_() {
  if (!AI_CONFIG.IMAGE_GENERATION.ENABLED) return null;

  try {
    const tracksForPrompt = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
    if (!tracksForPrompt || tracksForPrompt.length === 0) return null;

    const imagePrompt = createImagePromptFromTracks_(tracksForPrompt);
    if (!imagePrompt) return null;
    
    // Ланцужок мадэляў: Якасць -> Хуткасць -> Альтэрнатыва -> Класіка
    const modelFallbackChain = [
      AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.FLUX_DEV,     
      AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.FLUX_SCHNELL, 
      AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.SD3_MEDIUM,   
      AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.SDXL_BASE     
    ];

    let imageBase64 = null;

    for (const modelId of modelFallbackChain) {
      if (!modelId) continue;
      Logger.log(`🚀 Спроба генерацыі праз: "${modelId}"...`);
      imageBase64 = callHuggingFaceApiWithModel_(imagePrompt, modelId);
      if (imageBase64) {
        Logger.log(`✅ ПОСПЕХ! Малюнак атрыманы ад "${modelId}".`);
        return imageBase64; 
      } else {
        Logger.log(`⚠️ Мадэль "${modelId}" не адказала. Пераход да наступнай...`);
      }
    }
    return null;
  } catch (error) {
    Logger.log(`⚠️ Крытычная памылка генерацыі: ${error.toString()}`);
    return null;
  }
}

/**
 * [АБНОЎЛЕНА] Стварае промпт для малюнка з выкарыстаннем цыкла запасных мадэляў Gemini.
 */
function createImagePromptFromTracks_(tracks) {
  const trackSample = Selector.sliceRandom(tracks, 50); 
  const trackListString = trackSample.map(t => `${t.artists[0].name} - ${t.name}`).join('\n');

  const promptForPrompt = `
[Role]: Visionary art director.
[Input]: List of music tracks.
${trackListString}
[Task]: Generate a SINGLE, highly-detailed prompt for a square album cover based on the mood of these tracks.
[Rules]:
1. Metaphorical, not literal.
2. Define Artistic Style (e.g., Surrealism, Glitch Art, Oil Painting) and Color Palette.
3. Add technical keywords (8k, cinematic lighting, masterpiece).
[Constraints]: Output ONLY the prompt text. Length < 140 words.
`;

  try {
    const geminiApiKey = getGeminiApiKey_();
    let rawImagePrompt = null;
    
    // Выкарыстоўваем той жа спіс прыярытэтаў мадэляў
    for (const modelName of AI_CONFIG.GEMINI_MODELS_PRIORITY) {
      Logger.log(`🎨 Генерацыя промпта для вокладкі праз: "${modelName}"...`);
      rawImagePrompt = callGeminiApi_(geminiApiKey, modelName, promptForPrompt);
      if (rawImagePrompt) break; // Поспех
      Utilities.sleep(1000);
    }

    if (!rawImagePrompt) return null;

    // Ачыстка ад магчымага JSON-фарматавання
    try {
      const cleanString = rawImagePrompt.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanString);
      if (parsed && parsed.prompt) return parsed.prompt;
    } catch (e) {}
    
    return rawImagePrompt.replace(/`/g, '').trim();

  } catch (e) { return null; }
}

// ===============================================================
//                       ДАПАМОЖНЫЯ ФУНКЦЫІ
// ===============================================================

function normalizeTrackQuery_(rawQuery) {
  if (typeof rawQuery !== 'string') return "";
  let q = rawQuery.toLowerCase();
  // Спрошчаная транслітарацыя і ачыстка (пакіньце вашу поўную табліцу, калі яна ёсць)
  q = q.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').replace(/ - /g, ' ');
  q = q.replace(/[^a-z0-9\s\u0400-\u04FF]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return q;
}

function reverseTransliterate_(translitQuery) {
  // Слоўнік для аднаўлення беларускай/кірылічнай назвы
  const REVERSE_TABLE = {
    'shch':'шч','kh':'х','zh':'ж','ch':'ч','sh':'ш',
    'ya':'я','yu':'ю','ts':'ц','ia':'я','iu':'ю',
    'a':'а','b':'б','v':'в','g':'г','d':'д','e':'е','z':'з',
    'i':'і','k':'к','l':'л','m':'м','n':'н','o':'о','p':'п',
    'r':'р','s':'с','t':'т','u':'у','f':'ф','y':'ы'
  };
  
  // Калі ў запыце ўжо ёсць кірыліца або няма характэрных лацінскіх спалучэнняў, вяртаем null
  if (/[а-яёіў]/.test(translitQuery)) return null;
  
  let cyr = translitQuery;
  // Спачатку замяняем доўгія спалучэнні (shch, kh...)
  for (const [lat, c] of Object.entries(REVERSE_TABLE)) {
     // Выкарыстоўваем глабальны пошук
     cyr = cyr.split(lat).join(c); 
  }
  return (cyr !== translitQuery && cyr.length > 2) ? cyr : null;
}

function parseAiResponse_(rawResponse) {
  let cleaned = rawResponse.replace(/^\s*[\*\-]\s*/gm, '').replace(/^```json\s*/, '').replace(/\s*```$/, '').replace(/,\s*\]/g, ']');
  try {
    let tracks = JSON.parse(cleaned);
    if (Array.isArray(tracks)) return tracks.filter(item => typeof item === 'string');
  } catch (e) { return []; }
  return [];
}

function getGeminiApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error('Уласцівасць скрыпта GEMINI_API_KEY не зададзена!');
  return key;
}

function callGeminiApi_(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = { 
      "contents": [{"parts": [{"text": prompt}]}], 
      "generationConfig": {"responseMimeType": "application/json"} 
  };
  
  try {
    const response = UrlFetchApp.fetch(url, {
        'method': 'post', 
        'contentType': 'application/json', 
        'payload': JSON.stringify(payload), 
        'muteHttpExceptions': true
    });
    
    if (response.getResponseCode() === 200) {
      const json = JSON.parse(response.getContentText());
      return json.candidates?.[0]?.content?.parts?.[0]?.text || null;
    }
  } catch (e) {
    Logger.log(`Памылка Gemini API (${model}): ${e.toString()}`);
  }
  return null;
}

/**
 * [ФІНАЛЬНАЯ ВЕРСІЯ] Універсальны выклік API Hugging Face з наладамі пад мадэлі.
 */
function callHuggingFaceApiWithModel_(imagePrompt, modelId) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('HUGGINGFACE_API_KEY');
  if (!apiKey) {
      Logger.log('Уласцівасць HUGGINGFACE_API_KEY не зададзена!');
      return null;
  }

  const url = `https://router.huggingface.co/hf-inference/models/${modelId}`;
  const payload = { "inputs": imagePrompt, "parameters": {} };
  
  // Спецыфічныя налады пад розныя мадэлі
  if (modelId.includes('FLUX.1-schnell')) {
    payload.parameters.num_inference_steps = 4; 
    payload.parameters.guidance_scale = 0.0;
  } else if (modelId.includes('FLUX.1-dev')) {
    payload.parameters.num_inference_steps = 25; 
    payload.parameters.guidance_scale = 3.5;
    payload.parameters.width = 1024; payload.parameters.height = 1024;
  } else if (modelId.includes('stable-diffusion-3')) {
    payload.parameters.num_inference_steps = 28; 
    payload.parameters.guidance_scale = 7.0;
    payload.parameters.width = 1024; payload.parameters.height = 1024;
  } else {
    payload.parameters.width = 1024; payload.parameters.height = 1024;
  }

  try {
    let response = UrlFetchApp.fetch(url, {
      'method': 'post', 'headers': {'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json'},
      'payload': JSON.stringify(payload), 'muteHttpExceptions': true
    });

    // Апрацоўка "халоднага старту" (мадэль загружаецца на сэрверы)
    if (response.getResponseCode() === 503) {
      Logger.log(`⏳ Мадэль "${modelId}" загружаецца... чакаем 20с.`);
      Utilities.sleep(20000); 
      response = UrlFetchApp.fetch(url, {
        'method': 'post', 'headers': {'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json'},
        'payload': JSON.stringify(payload), 'muteHttpExceptions': true
      });
    }

    if (response.getResponseCode() === 200) {
      return Utilities.base64Encode(response.getBlob().getBytes());
    } else {
      Logger.log(`❌ Памылка HF API (${modelId}): ${response.getContentText()}`);
      return null;
    }
  } catch (error) { return null; }
}

/**
 * Функцыя перыядычнай ачысткі плэйліста ад праслуханых трэкаў.
 */
function cleanUpPlaylist() {
  const playlistId = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
  Logger.log(`Задача ачысткі: Пачатак...`);
  
  try {
    const playlistTracks = Source.getPlaylistTracks('', playlistId);
    if (!playlistTracks || playlistTracks.length === 0) return;

    Logger.log(`Атрыманне гісторыі за ${AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS} дзён...`);
    let recentHistory = RecentTracks.get();
    Filter.rangeDateRel(recentHistory, AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS, 0);
    
    if (recentHistory.length === 0) {
        Logger.log(`Няма праслуханых трэкаў за гэты перыяд.`);
        return;
    }

    const recentIds = new Set(recentHistory.map(t => t.id));
    const tracksToKeep = playlistTracks.filter(t => !recentIds.has(t.id));
    
    if (tracksToKeep.length < playlistTracks.length) {
      const removedCount = playlistTracks.length - tracksToKeep.length;
      Logger.log(`Выдаленне ${removedCount} праслуханых трэкаў...`);
      Playlist.saveWithReplace({ id: playlistId, tracks: tracksToKeep });
      Logger.log(`✅ Плэйліст ачышчаны.`);
    } else {
      Logger.log(`Супадзенняў не знойдзена.`);
    }
  } catch (e) {
    Logger.log(`ПАМЫЛКА ачысткі: ${e}`);
  }
}
