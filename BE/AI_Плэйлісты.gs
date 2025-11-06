/**
 * @OnlyCurrentDoc
 * Галоўны файл для працы з Gemini AI для стварэння плэйлістоў Spotify.
 * Гэты скрыпт аналізуе вашу бібліятэку, атрымлівае рэкамендацыі ад AI і генеруе карыстальніцкія вокладкі.
 *
 * Версія: 4.0 (Надзейная версія з модульным абнаўленнем плэйліста, ланцужком запасных мадэляў 
 * для генерацыі вокладак і палепшанай нармалізацыяй трэкаў.)
 */

// ===============================================================
//                           КАНФІГУРАЦЫЯ
// ===============================================================

const AI_CONFIG = {
  // === АБАВЯЗКОВЫЯ НАЛАДЫ ===

  // ID плэйліста Spotify, які будзе абнаўляцца.
  // Прыклад: '78uFpogH6uDyrEbFxzfp2L'
  SPOTIFY_PLAYLIST_ID: 'YOUR_SPOTIFY_PLAYLIST_ID_HERE', // <<<=== УСТАЎЦЕ ВАШ ID ПЛЭЙЛІСТА

  // === НАЛАДЫ AI І ПЛЭЙЛІСТА ===

  // Мадэль Gemini, якая будзе выкарыстоўвацца для генерацыі рэкамендацый.
  GEMINI_MODEL: 'gemini-2.5-pro',

  // Колькасць выпадковых трэкаў з вашай бібліятэкі для аналізу AI.
  TRACK_SAMPLE_SIZE_FOR_AI: 700,

  // Максімальны памер фінальнага плэйліста.
  MAX_PLAYLIST_SIZE: 500,

  // Шаблон для назвы плэйліста. {date} будзе заменена на бягучую дату.
  PLAYLIST_NAME_TEMPLATE: 'AI Плэйліст ад {date}',

  // === НАЛАДЫ ГЕНЕРАЦЫІ ВОКЛАДКІ (ПРАЗ HUGGING FACE) ===

  IMAGE_GENERATION: {
    ENABLED: true,
    // [РЭКАМЕНДАВАНЫЯ МАДЭЛІ] Гэтыя мадэлі правераны і даюць добры вынік.
    AVAILABLE_MODELS: {
      FLUX_SCHNELL: 'black-forest-labs/FLUX.1-schnell', // Лепшы баланс хуткасці і якасці
      STABLE_DIFFUSION_3: 'stabilityai/stable-diffusion-3-medium-diffusers', // Лепшая якасць
      DEFAULT_SDXL: 'stabilityai/stable-diffusion-xl-base-1.0' // Надзейная класіка
    }
  },

  // === НАЛАДЫ АЧЫСТКІ ПЛЭЙЛІСТА ===

  // Перыяд (у днях), за які праслуханыя трэкі будуць выдаляцца з плэйліста.
  CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS: 30,
};

// ===============================================================
//                АСНОЎНАЯ ФУНКЦЫЯ ГЕНЕРАЦЫІ ПЛЭЙЛІСТА
// ===============================================================

/**
 * Галоўная функцыя для генерацыі і абнаўлення плэйліста Spotify з дапамогай Gemini AI.
 */
function generateAndCreateSpotifyPlaylist() {
  try {
    Logger.log('Пачатак працэсу стварэння AI плэйліста...');
    const geminiApiKey = getGeminiApiKey_();
    const randomTracksJsonString = prepareTracksForPrompt_();
    if (!randomTracksJsonString) return;

    Logger.log('Стварэнне промпту для Gemini AI...');
    const promptText = createTrackRecommendationPrompt_(randomTracksJsonString);

    Logger.log(`Выклік мадэлі ${AI_CONFIG.GEMINI_MODEL}...`);
    const aiResponseJsonString = callGeminiApi_(geminiApiKey, AI_CONFIG.GEMINI_MODEL, promptText);
    if (!aiResponseJsonString) {
      throw new Error('Атрыманы пусты або несапраўдны адказ ад Gemini API.');
    }

    const tracksToSearch = parseAiResponse_(aiResponseJsonString);
    if (tracksToSearch.length === 0) {
      Logger.log('AI не вярнуў трэкаў для пошуку. Спыненне выканання.');
      return;
    }
    Logger.log(`AI рэкамендаваў ${tracksToSearch.length} трэкаў для пошуку.`);

    const normalizedQueries = [...new Set(tracksToSearch.map(track => normalizeTrackQuery_(track)).filter(q => q))];

    Logger.log(`Пошук ${normalizedQueries.length} трэкаў на Spotify...`);
    let foundSpotifyTracks = Search.multisearchTracks(normalizedQueries);
    Filter.dedupTracks(foundSpotifyTracks);
    Logger.log(`Усяго знойдзена ${foundSpotifyTracks.length} унікальных трэкаў на Spotify.`);

    if (foundSpotifyTracks.length === 0) {
      Logger.log('Не знойдзена ніводнага трэка на Spotify. Спыненне выканання.');
      return;
    }

    // Выклік модульнай логікі абнаўлення плэйліста
    updatePlaylistIncrementally_(foundSpotifyTracks);

    Logger.log('✅ Працэс стварэння/абнаўлення плэйліста паспяхова завершаны.');

  } catch (error) {
    Logger.log(`КРЫТЫЧНАЯ ПАМЫЛКА: ${error.toString()}`);
    Logger.log(`Стэк выклікаў: ${error.stack}`);
  }
}

// ===============================================================
//                МОДУЛЬНАЕ АБНАЎЛЕННЕ ПЛЭЙЛІСТА
// ===============================================================

/**
 * Інкрэментальна абнаўляе плэйліст: дадае новыя трэкі і запускае працэсы 
 * абнаўлення метаданых і абразання.
 * @param {Array<Object>} foundSpotifyTracks Масіў новых трэкаў для дадання.
 */
function updatePlaylistIncrementally_(foundSpotifyTracks) {
  const playlistId = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
  Logger.log(`Атрыманне існуючых трэкаў з плэйліста ID: ${playlistId}...`);
  const existingPlaylistTracks = Source.getPlaylistTracks('', playlistId);
  
  let newUniqueTracks = Selector.sliceCopy(foundSpotifyTracks);
  Filter.removeTracks(newUniqueTracks, existingPlaylistTracks);
  const newTracksCount = newUniqueTracks.length;

  if (newTracksCount > 0) {
    Logger.log(`Знойдзена ${newTracksCount} новых трэкаў. Пачатак папарцыйнага дадання...`);
    const CHUNK_SIZE = 100; // Ліміт Spotify API
    for (let i = 0; i < newTracksCount; i += CHUNK_SIZE) {
      const chunk = newUniqueTracks.slice(i, i + CHUNK_SIZE);
      Logger.log(`Даданне часткі з ${chunk.length} трэкаў...`);
      try {
        Playlist.saveWithAppend({ id: playlistId, tracks: chunk, position: 'begin' });
        if (newTracksCount > CHUNK_SIZE) Utilities.sleep(1000); // Паўза паміж запытамі
      } catch (e) {
        Logger.log(`ПАМЫЛКА падчас дадання часткі трэкаў: ${e.toString()}`);
      }
    }
  } else {
    Logger.log('Новых трэкаў для дадавання не знойдзена.');
  }
  
  const finalTotalTracks = Source.getPlaylistTracks('', playlistId).length;

  // Абнаўляем назву, апісанне і вокладку асобна
  updatePlaylistDetailsAndCover_(newTracksCount, finalTotalTracks);
  
  // Запускаем праверку і абразанне плэйліста
  trimPlaylistIfNeeded_();
}

/**
 * Абнаўляе метаданыя плэйліста (назву, апісанне) і вокладку, не закранаючы спіс трэкаў.
 * Выкарыстоўвае прамыя API-запыты для захавання арыгінальных дат дадання трэкаў.
 * @param {number} addedCount Колькасць дададзеных трэкаў.
 * @param {number} totalCount Агульная колькасць трэкаў у плэйлісце.
 */
function updatePlaylistDetailsAndCover_(addedCount, totalCount) {
    const playlistId = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
    const coverImageBase64 = generatePlaylistCover_();

    const playlistName = AI_CONFIG.PLAYLIST_NAME_TEMPLATE.replace('{date}', new Date().toLocaleDateString('be-BY'));
    const formattedDateTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMMM yyyy, HH:mm');

    const payload = {
      name: playlistName,
      description: `Апошняе абнаўленне: ${formattedDateTime}. Дададзена: ${addedCount}. Агулам: ${totalCount}.`
    };

    Logger.log(`Абнаўленне назвы і апісання праз прамы API-запыт...`);
    try {
        SpotifyRequest.put(`${API_BASE_URL}/playlists/${playlistId}`, payload);
        Logger.log('✅ Назва і апісанне паспяхова абноўлены.');
    } catch (e) {
        Logger.log(`⚠️ Памылка падчас абнаўлення дэталяў плэйліста: ${e.toString()}`);
    }

    if (coverImageBase64) {
        Logger.log('Загрузка новай вокладкі...');
        try {
            SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${playlistId}/images`, coverImageBase64);
            Logger.log('✅ Вокладка паспяхова загружана.');
        } catch (e) {
            Logger.log(`⚠️ Памылка падчас загрузкі вокладкі: ${e.toString()}`);
        }
    }
}

/**
 * Правярае памер плэйліста і абразае яго, калі ён перавышае ліміт `MAX_PLAYLIST_SIZE`.
 */
function trimPlaylistIfNeeded_() {
  const playlistId = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
  const currentTracks = Source.getPlaylistTracks('', playlistId);
  
  if (currentTracks.length > AI_CONFIG.MAX_PLAYLIST_SIZE) {
    const tracksToRemoveCount = currentTracks.length - AI_CONFIG.MAX_PLAYLIST_SIZE;
    Logger.log(`Плэйліст перавышае ліміт (${AI_CONFIG.MAX_PLAYLIST_SIZE}). Выдаленне ${tracksToRemoveCount} самых старых трэкаў...`);
    
    const trimmedTracks = currentTracks.slice(0, AI_CONFIG.MAX_PLAYLIST_SIZE);
    
    Playlist.saveWithReplace({
      id: playlistId,
      tracks: trimmedTracks
    });
    Logger.log('Плэйліст паспяхова абрэзаны.');
  }
}


// ===============================================================
//                     СТВАРЭННЕ ПРОМПТАЎ ДЛЯ AI
// ===============================================================

function prepareTracksForPrompt_() {
  Logger.log('Атрыманне трэкаў з кэша Goofy (SavedTracks.json)...');
  const allTracks = Cache.read('SavedTracks.json');
  if (!allTracks || allTracks.length === 0) {
    Logger.log('ПАМЫЛКА: Не атрымалася прачытаць трэкі. Пераканайцеся, што Goofy наладжаны і ўжо працаваў.');
    return null;
  }
  const randomTracks = Selector.sliceRandom(allTracks, AI_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
  Logger.log(`Абрана ${randomTracks.length} выпадковых трэкаў для аналізу.`);
  return JSON.stringify(randomTracks);
}

function createTrackRecommendationPrompt_(tracksJsonString) {
  const today = new Date();
  const formattedDate = today.toLocaleDateString('be-BY', { year: 'numeric', month: 'long', day: 'numeric' });

  return `
[Роля]: Ты — музычны куратар і даследчык, які спецыялізуецца на выяўленні нечаканых сувязяў паміж рознымі музычнымі сцэнамі, жанрамі і эпохамі.
[Кантэкст]: Я прадастаўляю табе выпадковую выбарку трэкаў з маёй музычнай бібліятэкі. Твая мэта — прааналізаваць мае густы і стварыць дакладны плэйліст для адкрыцця новай музыкі.
[Часавы кантэкст]: Сённяшняя дата: ${formattedDate}. Выкарыстай гэта, каб вызначыць бягучы сезон і настрой (напр., позняе лета, восеньская меланхолія) і дазволь гэтаму ўплываць на частку тваіх рэкамендацый.
[Уваходныя даныя]: Спіс трэкаў у фармаце JSON.
\`\`\`json
${tracksJsonString}
\`\`\`
[Задача]:
1. Прааналізуй уваходныя даныя, каб вызначыць асноўныя жанры, настрой, эпохі і характэрныя рысы майго музычнага густу.
2. На аснове гэтага аналізу і часавага кантэксту згенеруй спіс з 200 музычных трэкаў для адкрыцця новай музыкі.
[Абмежаванні і правілы]:
- **Без дублікатаў:** НЕ ўключай трэкі, якія ўжо ёсць ва ўваходных даных.
- **Прыярытэт навізны:** Прапаноўвай выканаўцаў, якіх няма ў зыходным спісе.
- **Разнастайнасць:** ~70% рэкамендацый павінны дакладна адпавядаць густам, ~30% — быць смелым "крокам убок" (сумежныя жанры, іншыя эпохі, геаграфія).
- **Жанравая класіка:** Уключы ~5 знакавых шлягераў з дамінуючага жанру.
- **Лакальная сцэна:** Каля 30% выканаўцаў павінны быць з Беларусі.
- **Моўны фільтр:** Пазбягай песень на рускай мове, і **НІКОЛІ** не дадавай рускамоўных песень расейскіх выканаўцаў.
[Фармат вываду]:
- Адказ павінен быць ВЫКЛЮЧНА валідным JSON-масівам. Кожны элемент — радок у фармаце "Artist Name - Track Title".
- Не дадавай ніякіх тлумачэнняў, каментароў або markdown.
- **ВЕЛЬМІ ВАЖНА ДЛЯ ПОШУКУ:** Усе назвы павінны быць у ніжнім рэгістры. Выдалі ўсе спецсімвалы, акрамя дэфіса. Не дадавай метаданыя ('remastered', 'live').
[Прыклад ідэальнага вываду]:
["the cure - a forest", "joy division - disorder", "molchat doma - sudno borys ryzhyi", "lavon volski - pavietrany shar"]
`;
}

// ===============================================================
//                     ГЕНЕРАЦЫЯ ВОКЛАДКІ
// ===============================================================

/**
 * Спрабуе згенераваць вокладку, паслядоўна выкарыстоўваючы мадэлі з `modelFallbackChain` 
 * для максімальнай надзейнасці.
 * @return {string | null} Малюнак у фармаце Base64 або null, калі ўсе спробы няўдалыя.
 */
function generatePlaylistCover_() {
  if (!AI_CONFIG.IMAGE_GENERATION.ENABLED) {
    Logger.log('Генерацыя вокладкі выключана ў наладах.');
    return null;
  }
  const tracksForPrompt = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  if (!tracksForPrompt || tracksForPrompt.length === 0) {
    Logger.log('Плэйліст пусты, генерацыя вокладкі прапушчана.');
    return null;
  }

  const imagePrompt = createImagePromptFromTracks_(tracksForPrompt);
  if (!imagePrompt) {
    Logger.log('Не атрымалася стварыць промпт для малюнка.');
    return null;
  }
  
  // Ланцужок запасных мадэляў для надзейнай генерацыі
  const modelFallbackChain = [
    AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.FLUX_SCHNELL,
    AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.STABLE_DIFFUSION_3,
    AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.DEFAULT_SDXL
  ];

  for (const modelId of modelFallbackChain) {
    const imageBase64 = callHuggingFaceApiWithModel_(imagePrompt, modelId);
    if (imageBase64) {
      Logger.log(`✅ Малюнак паспяхова згенераваны з дапамогай "${modelId}".`);
      return imageBase64; // Вяртаем вынік першай паспяховай генерацыі
    }
  }
  
  Logger.log('❌ Усе мадэлі з ланцужка не змаглі згенераваць малюнак.');
  return null;
}

/**
 * Стварае тэкставы промпт для генератара малюнкаў на аснове спісу трэкаў.
 * @param {Array<Object>} tracks Масіў трэкаў для аналізу.
 * @return {string | null} Гатовы промпт або null.
 */
function createImagePromptFromTracks_(tracks) {
  const trackSample = Selector.sliceRandom(tracks, 50); 
  const trackListString = trackSample.map(t => `${t.artists[0].name} - ${t.name}`).join('\n');
  const promptForPrompt = `
[Role]: You are a professional art director creating prompts for AI image generators.
[Context]: Analyze the combined mood of these music tracks to create a SINGLE, detailed, technically precise prompt for a square album cover.
[Input Data]:
${trackListString}
[Rules]:
- Include keywords for high quality: "hyperrealistic", "8k resolution", "intricate details".
- Suggest a specific visual style: "cinematic still", "lomography photo", "double exposure", "surrealism".
- Describe lighting in detail: "cinematic lighting", "volumetric light", "moody".
- Focus on abstract emotions, not literal scenes.
- The prompt must be a single paragraph under 120 words and in English.
[Output Format]: ONLY the text of the prompt itself. No explanations or quotes.
`;
  try {
    const geminiApiKey = getGeminiApiKey_();
    // Выкарыстоўваем хуткую мадэль для генерацыі промпта
    const imagePromptText = callGeminiApi_(geminiApiKey, 'gemini-2.5-flash', promptForPrompt); 
    return imagePromptText ? imagePromptText.replace(/[`"']/g, '').trim() : null;
  } catch (e) {
    Logger.log(`Не атрымалася стварыць промпт для малюнка: ${e}`);
    return null;
  }
}

// ===============================================================
//                       ДАПАМОЖНЫЯ ФУНКЦЫІ
// ===============================================================

/**
 * Выклікае Inference API Hugging Face. Выкарыстоўвае абноўлены эндпойнт `router.huggingface.co`
 * для сумяшчальнасці. Рэалізуе логіку паўтору пры атрыманні кода 503, які азначае 
 * 'халодны старт' мадэлі.
 * @param {string} imagePrompt - Тэкставы запыт для генерацыі малюнка.
 * @param {string} modelId - ID мадэлі на Hugging Face.
 * @return {string | null} - Малюнак у фармаце Base64 або null у выпадку памылкі.
 */
function callHuggingFaceApiWithModel_(imagePrompt, modelId) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('HUGGINGFACE_API_KEY');
  if (!apiKey) {
    Logger.log('Памылка: API-ключ для Hugging Face (HUGGINGFACE_API_KEY) не знойдзены.');
    return null;
  }

  // Выкарыстанне новага, абавязковага URL для Hugging Face Inference API
  const url = `https://router.huggingface.co/hf-inference/models/${modelId}`;

  const payload = { 
    "inputs": imagePrompt, 
    "parameters": {} 
  };
  
  if (modelId.includes('FLUX.1-schnell')) {
    payload.parameters.num_inference_steps = 8;
    payload.parameters.guidance_scale = 0.0;
  }

  const options = {
    'method': 'post',
    'headers': {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    Logger.log(`Адпраўка запыту на генерацыю ў мадэль "${modelId}"...`);
    let response = UrlFetchApp.fetch(url, options);
    let responseCode = response.getResponseCode();

    // Аўтаматычны паўтор, калі мадэль загружаецца ("cold start")
    if (responseCode === 503) {
      Logger.log('Мадэль на Hugging Face загружаецца. Чакаем 20 секунд і спрабуем яшчэ раз...');
      Utilities.sleep(20000); 
      response = UrlFetchApp.fetch(url, options);
      responseCode = response.getResponseCode();
    }

    if (responseCode === 200) {
      const imageBlob = response.getBlob();
      return Utilities.base64Encode(imageBlob.getBytes());
    } else {
      const responseBody = response.getContentText();
      Logger.log(`Памылка выкліку Hugging Face API для "${modelId}". Код: ${responseCode}. Адказ: ${responseBody}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Выключэнне падчас выкліку Hugging Face API для "${modelId}": ${error}`);
    return null;
  }
}

/**
 * Нармалізуе радок з назвай трэка для максімальнай дакладнасці пошуку.
 * Уключае транслітарацыю кірыліцы і апрацоўку дыякрытычных знакаў (напр., 'é' -> 'e').
 * @param {string} rawQuery - Сыры радок ад AI.
 * @return {string} Ачышчаны радок, гатовы для пошуку.
 */
function normalizeTrackQuery_(rawQuery) {
  if (typeof rawQuery !== 'string' || rawQuery.length === 0) return "";
  const TRANSLIT_TABLE = { 'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'i','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'iu','я':'ia','і':'i','ў':'u','ґ':'g','є':'ie','ї':'i' };
  const DIACRITICS_MAP = { 'ä':'a', 'á':'a', 'à':'a', 'â':'a', 'ã':'a', 'å':'a','ç':'c', 'ć':'c', 'č':'c','é':'e', 'è':'e', 'ê':'e', 'ë':'e','í':'i', 'ì':'i', 'î':'i', 'ï':'i','ł':'l','ñ':'n', 'ń':'n','ö':'o', 'ó':'o', 'ò':'o', 'ô':'o', 'õ':'o', 'ø':'o','š':'s', 'ś':'s','ü':'u', 'ú':'u', 'ù':'u', 'û':'u','ý':'y','ž':'z', 'ź':'z', 'ż':'z' };

  let cleanedQuery = rawQuery.toLowerCase();
  cleanedQuery = cleanedQuery.split('').map(char => TRANSLIT_TABLE[char] || DIACRITICS_MAP[char] || char).join('');
  cleanedQuery = cleanedQuery.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').trim();
  const noiseWords = ['remastered', 'remaster', 'live', 'radio edit', 'album version', 'feat', 'ft'];
  noiseWords.forEach(word => { cleanedQuery = cleanedQuery.replace(new RegExp(`\\b${word}\\b`, 'gi'), ''); });
  cleanedQuery = cleanedQuery.replace(/^the\s+/, '');
  cleanedQuery = cleanedQuery.replace(/[^a-z0-9\s-]/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return cleanedQuery;
}

function parseAiResponse_(rawResponse) {
  let cleanedJsonString = rawResponse.replace(/^\s*[\*\-]\s*/gm, '').replace(/^```json\s*/, '').replace(/\s*```$/, '').replace(/,\s*\]/g, ']');
  try {
    let tracks = JSON.parse(cleanedJsonString);
    if (!Array.isArray(tracks)) throw new Error("Адказ AI не з'яўляецца масівам.");
    const validTracks = tracks.filter(item => typeof item === 'string' && item.trim().length > 0);
    if (validTracks.length !== tracks.length) {
      Logger.log(`Папярэджанне: ${tracks.length - validTracks.length} несапраўдных элементаў было выдалена з адказу AI.`);
    }
    return validTracks;
  } catch (e) {
    Logger.log(`КРЫТЫЧНАЯ памылка парсінгу: ${e.message}\nСыры адказ: ${rawResponse}`);
    return [];
  }
}

function getGeminiApiKey_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error("API-ключ 'GEMINI_API_KEY' не знойдзены ва ўласцівасцях скрыпта.");
  return apiKey;
}

function callGeminiApi_(apiKey, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const requestPayload = {
     "contents": [{"parts": [{"text": prompt}]}],
     "generationConfig": {
       "temperature": 1.2,
       "responseMimeType": "application/json"
     },
     "safetySettings": [
        { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
      ]
   };
  if (model.includes('1.5')) {
      requestPayload.generationConfig.responseSchema = {"type": "array", "items": { "type": "string" }};
  }
  const options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(requestPayload), 'muteHttpExceptions': true };

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();
  if (responseCode === 200) {
    const jsonResponse = JSON.parse(responseBody);
    if (jsonResponse.candidates && jsonResponse.candidates[0]?.content?.parts[0]?.text) {
        return jsonResponse.candidates[0].content.parts[0].text;
    }
  }
  Logger.log(`Памылка выкліку Gemini API. Код: ${responseCode}. Адказ: ${responseBody}`);
  return null;
}

// ===============================================================
//                  АПЦЫЯНАЛЬНАЯ ФУНКЦЫЯ АЧЫСТКІ
// ===============================================================

function cleanUpPlaylist() {
  const playlistId = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
  Logger.log(`Задача ачысткі: Пачатак для плэйліста ID: ${playlistId}`);
  try {
    const playlistTracks = Source.getPlaylistTracks('', playlistId);
    if (playlistTracks.length === 0) {
      Logger.log(`Плэйліст пусты. Завяршэнне.`);
      return;
    }
    const initialTrackCount = playlistTracks.length;

    Logger.log(`Атрыманне гісторыі праслухоўванняў за апошнія ${AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS} дзён...`);
    let recentTracksHistory = RecentTracks.get();
    Filter.rangeDateRel(recentTracksHistory, AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS, 0);
    
    if (recentTracksHistory.length === 0) {
        Logger.log(`Не знойдзена праслуханых трэкаў за зададзены перыяд. Змены не патрабуюцца.`);
        return;
    }

    const recentTrackIds = new Set(recentTracksHistory.map(track => track.id));
    const tracksToKeep = playlistTracks.filter(track => !recentTrackIds.has(track.id));
    const tracksToRemoveCount = initialTrackCount - tracksToKeep.length;

    if (tracksToRemoveCount > 0) {
      Logger.log(`${tracksToRemoveCount} праслуханых трэкаў будзе выдалена. Абнаўленне плэйліста...`);
      Playlist.saveWithReplace({ id: playlistId, tracks: tracksToKeep });
      Logger.log(`✅ Задача ачысткі: Плэйліст паспяхова абноўлены.`);
    } else {
      Logger.log(`Супадзенняў не знойдзена. Змены не патрабуюцца.`);
    }
  } catch (error) {
    Logger.log(`ПАМЫЛКА задачы ачысткі: ${error.toString()}`);
  }
}
