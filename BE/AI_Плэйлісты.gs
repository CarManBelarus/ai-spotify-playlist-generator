/**
 * @OnlyCurrentDoc
 * Галоўny файл для працы з Gemini AI для стварэння плэйлістоў Spotify.
 * Гэты скрыпт аналізуе вашу бібліятэку, атрымлівае рэкамендацыі ад AI і генеруе карыстальніцкія вокладкі.
 *
 * Версія: 3.0 (Надзейнае інкрэментальнае абнаўленне, палепшаная ачыстка, пашыраныя канфігурацыі)
 */

// ===============================================================
//                           КАНФІГУРАЦЫЯ
// ===============================================================

const AI_CONFIG = {
  // === АБАВЯЗКОВЫЯ НАЛАДЫ ===

  // ID плэйліста Spotify, які будзе абнаўляцца.
  // ЯК АТРЫМАЦЬ: Перайдзіце да свайго плэйліста ў Spotify, націсніце "...", перайдзіце ў "Падзяліцца", 
  // і "Скапіяваць спасылку на плэйліст". ID — гэта радок сімвалаў пасля "playlist/".
  // Прыклад: '78uFpogH6uDyrEbFxzfp2L'
  SPOTIFY_PLAYLIST_ID: 'YOUR_SPOTIFY_PLAYLIST_ID_HERE', // <<<=== УСТАЎЦЕ ВАШ ID ПЛЭЙЛІСТА

  // === НАЛАДЫ AI І ПЛЭЙЛІСТА ===

  // Мадэль Gemini, якая будзе выкарыстоўвацца для генерацыі рэкамендацый.
  // 'gemini-1.5-pro-latest' — магутная; 'gemini-1.5-flash-latest' — больш хуткая.
  GEMINI_MODEL: 'gemini-1.5-pro-latest',

  // Колькасць выпадковых трэкаў з вашай бібліятэкі для аналізу AI.
  // Большая выбарка дае AI лепшае разуменне вашых густаў. 700 — добры баланс.
  TRACK_SAMPLE_SIZE_FOR_AI: 700,

  // Максімальны памер фінальнага плэйліста.
  // Калі плэйліст стане большым, самыя старыя трэкі будуць выдалены.
  MAX_PLAYLIST_SIZE: 500,

  // Шаблон для назвы плэйліста. {date} будзе заменена на бягучую дату.
  PLAYLIST_NAME_TEMPLATE: 'AI Плэйліст ад {date}',

  // === НАЛАДЫ ГЕНЕРАЦЫІ ВОКЛАДКІ (ПРАЗ HUGGING FACE) ===

  IMAGE_GENERATION: {
    // Уключыць ці выключыць генерацыю вокладак (true/false)
    ENABLED: true,
    
    // Выбар мадэлі для генерацыі. Проста скапіруйце ID з аднаго з варыянтаў ніжэй.
    // Рэкамендацыя: JUGGERNAUT_XL або PHOTO_REALISTIC даюць выдатныя вынікі.
    SELECTED_MODEL_ID: 'black-forest-labs/FLUX.1-schnell',

    // Даступныя мадэлі (можна дадаваць свае, знойдзеныя на Hugging Face)
    AVAILABLE_MODELS: {
      // --- РЭКАМЕНДАЦЫІ ---
      JUGGERNAUT_XL: 'RunDiffusion/Juggernaut-XL-v9', // Вельмі папулярная мадэль для кінематаграфічнага фотарэалізму.
      SD_3_MEDIUM: 'stabilityai/stable-diffusion-3-medium-diffusers', // Stable Diffusion 3: найноўшая, вельмі дакладная мадэль.
      PHOTO_REALISTIC: 'playgroundai/playground-v2.5-1024px-aesthetic', // Выдатная эстэтычная мадэль.
      FLUX: 'black-forest-labs/FLUX.1-schnell', // Вельмі хуткая і якасная мадэль.

      // --- ІНШЫЯ СТЫЛІ ---
      ARTISTIC: 'openskyml/dreamshaper-xl-1-0', // Лепшая для мастацкага, "карціннага" стылю.
      ANIME: 'cagliostrolab/animagine-xl-3.0', // Лепшая для стылю анімэ.
      TURBO: 'stabilityai/sdxl-turbo', // Вельмі хуткая версія SDXL для тэстаў.
      DEFAULT_SDXL: 'stabilityai/stable-diffusion-xl-base-1.0' // Стандартны Stable Diffusion XL.
    }
  },

  // === НАЛАДЫ АЧЫСТКІ ПЛЭЙЛІСТА (для апцыянальнай функцыі cleanUpPlaylist) ===

  // Перыяд (у днях), за які праслуханыя трэкі будуць выдаляцца з плэйліста.
  // Напрыклад, 30 азначае, што любы трэк, які вы слухалі за апошнія 30 дзён, будзе выдалены.
  CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS: 30,
};

// ===============================================================
//                АСНОЎНАЯ ФУНКЦЫЯ ГЕНЕРАЦЫІ ПЛЭЙЛІСТА
// ===============================================================

/**
 * Галоўная функцыя для генерацыі і абнаўлення плэйліста Spotify з дапамогай Gemini AI.
 * Гэта функцыя, якую вы павінны запускаць або ставіць на расклад.
 */
function generateAndCreateSpotifyPlaylist() {
  try {
    Logger.log('Пачатак працэсу стварэння AI плэйліста...');
    const geminiApiKey = getGeminiApiKey_();

    const randomTracksJsonString = prepareTracksForPrompt_();

    Logger.log('Стварэнне тэксту запыту (промпту) для Gemini AI...');
    const promptText = createTrackRecommendationPrompt_(randomTracksJsonString);

    Logger.log(`Выклік мадэлі ${AI_CONFIG.GEMINI_MODEL}...`);
    const aiResponseJsonString = callGeminiApi_(geminiApiKey, AI_CONFIG.GEMINI_MODEL, promptText);
    if (!aiResponseJsonString) {
      throw new Error('Атрыманы пусты або несапраўдны адказ ад Gemini API.');
    }

    Logger.log('Парсінг JSON-адказу ад AI...');
    const tracksToSearch = parseAiResponse_(aiResponseJsonString);
    Logger.log(`AI рэкамендаваў ${tracksToSearch.length} трэкаў для пошуку.`);

    if (tracksToSearch.length === 0) {
      Logger.log('AI не вярнуў трэкаў для пошуку. Спыненне выканання.');
      return;
    }

    Logger.log('Нармалізацыя запытаў перад адпраўкай у Spotify...');
    const normalizedTracksToSearch = tracksToSearch.map(track => normalizeTrackQuery_(track));

    Logger.log(`Пошук ${normalizedTracksToSearch.length} трэкаў на Spotify...`);
    let foundSpotifyTracks = Search.multisearchTracks(normalizedTracksToSearch);
    Logger.log(`Знойдзена ${foundSpotifyTracks.length} трэкаў на Spotify.`);

    if (foundSpotifyTracks.length === 0) {
      Logger.log('Не знойдзена ніводнага трэка на Spotify па рэкамендацыях AI. Спыненне выканання.');
      return;
    }

    updatePlaylistAndCover_(foundSpotifyTracks);

    Logger.log('Працэс стварэння/абнаўлення плэйліста паспяхова завершаны.');

  } catch (error) {
    Logger.log(`КРЫТЫЧНАЯ ПАМЫЛКА: ${error.toString()}`);
    Logger.log(`Стэк выклікаў: ${error.stack}`);
  }
}

// ===============================================================
//                АБНАЎЛЕННЕ ПЛЭЙЛІСТА І ВОКЛАДКІ
// ===============================================================

/**
 * [НОВАЯ ВЕРСІЯ] Комплексна абнаўляе плэйліст: папарцыйна дадае новыя трэкі,
 * абразае старыя да ліміту і абнаўляе метаданыя (назву, апісанне, вокладку).
 * @param {Array<Object>} foundSpotifyTracks Масіў трэкаў, рэкамендаваных AI.
 */
function updatePlaylistAndCover_(foundSpotifyTracks) {
  Logger.log(`Атрыманне існуючых трэкаў з плэйліста ID: ${AI_CONFIG.SPOTIFY_PLAYLIST_ID}...`);
  const existingPlaylistTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  
  let newUniqueTracks = Selector.sliceCopy(foundSpotifyTracks);
  Filter.removeTracks(newUniqueTracks, existingPlaylistTracks);
  const newTracksCount = newUniqueTracks.length;
  Logger.log(`Знойдзена ${newTracksCount} новых, унікальных трэкаў для дадавання.`);

  // --- ЭТАП 1: Даданне новых трэкаў (калі яны ёсць) ---
  if (newTracksCount > 0) {
    Logger.log(`Пачатак папарцыйнага дадання ${newTracksCount} трэкаў...`);
    const CHUNK_SIZE = 100; // Ліміт Spotify API
    for (let i = 0; i < newTracksCount; i += CHUNK_SIZE) {
      const chunk = newUniqueTracks.slice(i, i + CHUNK_SIZE);
      Logger.log(`Даданне часткі з ${chunk.length} трэкаў...`);
      try {
        Playlist.saveWithAppend({
          id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
          tracks: chunk,
          position: 'begin' // Дадаем новыя трэкі ў пачатак
        });
        if (newTracksCount > CHUNK_SIZE) Utilities.sleep(1000); // Паўза паміж запытамі
      } catch (e) {
        Logger.log(`ПАМЫЛКА падчас дадання часткі трэкаў: ${e.toString()}`);
      }
    }
    Logger.log('Папарцыйнае даданне трэкаў завершана.');
  }

  // --- ЭТАП 2: Абразанне плэйліста да ліміту (калі трэба) ---
  const currentTracksAfterAdd = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  if (currentTracksAfterAdd.length > AI_CONFIG.MAX_PLAYLIST_SIZE) {
    const tracksToRemoveCount = currentTracksAfterAdd.length - AI_CONFIG.MAX_PLAYLIST_SIZE;
    Logger.log(`Плэйліст перавышае ліміт (${AI_CONFIG.MAX_PLAYLIST_SIZE}). Выдаленне ${tracksToRemoveCount} самых старых трэкаў...`);
    const trimmedTracks = currentTracksAfterAdd.slice(0, AI_CONFIG.MAX_PLAYLIST_SIZE);
    Playlist.saveWithReplace({
      id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
      tracks: trimmedTracks
    });
    Logger.log('Плэйліст паспяхова абрэзаны.');
  }

  // --- ЭТАП 3: Абнаўленне назвы, апісання і вокладкі ---
  const finalTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  
  const playlistName = AI_CONFIG.PLAYLIST_NAME_TEMPLATE.replace('{date}', new Date().toLocaleDateString('be-BY'));
  const formattedDateTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMMM yyyy, HH:mm');

  const payload = {
    name: playlistName,
    description: `Апошняе абнаўленне: ${formattedDateTime}. Дададзена: ${newTracksCount} новых. Агулам: ${finalTracks.length}.`
  };

  Logger.log(`Абнаўленне назвы і апісання плэйліста...`);
  try {
    SpotifyRequest.put(`${API_BASE_URL}/playlists/${AI_CONFIG.SPOTIFY_PLAYLIST_ID}`, payload);
    Logger.log('✅ Назва і апісанне паспяхова абноўлены.');
  } catch (e) {
    Logger.log(`⚠️ Памылка падчас абнаўлення дэталяў плэйліста: ${e.toString()}`);
  }

  Logger.log('Спроба згенераваць і загрузіць новую вокладку...');
  const coverImageBase64 = generatePlaylistCover_(finalTracks);
  if (coverImageBase64) {
    try {
      SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${AI_CONFIG.SPOTIFY_PLAYLIST_ID}/images`, coverImageBase64);
      Logger.log('✅ Вокладка паспяхова загружана.');
    } catch (e) {
      Logger.log(`⚠️ Памылка падчас загрузкі вокладкі: ${e.toString()}`);
    }
  }
}

// ===============================================================
//                     СТВАРЭННЕ ПРОМПТАЎ ДЛЯ AI
// ===============================================================

function prepareTracksForPrompt_() {
  Logger.log('Парсінг SavedTracks.json з дапамогай кэша Goofy і выбарка трэкаў...');
  const allTracks = Cache.read('SavedTracks.json');
  if (!allTracks || allTracks.length === 0) {
    throw new Error('Не атрымалася прачытаць трэкі з SavedTracks.json. Пераканайцеся, што Goofy наладжаны і ўжо працаваў.');
  }
  Logger.log(`Паспяхова прачытана ${allTracks.length} трэкаў.`);
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

[Часавы кантэкст]: Сённяшняя дата: ${formattedDate}. Выкарыстай гэта, каб вызначыць бягучы сезон і настрой (напрыклад, позняе лета, восеньская меланхолія) і дазволь гэтаму ўплываць на частку тваіх рэкамендацый.

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
- **Разнастайнасць:**
    - ~70% рэкамендацый павінны дакладна адпавядаць вызначаным густам.
    - ~30% павінны быць смелым "крокам убок": эксперыментуй з менш відавочнымі сумежнымі жанрамі (напр., калі ёсць пост-панк, прапануй coldwave або minimal synth), іншымі эпохамі (70-я, 2020-я) або геаграфіяй (напр., японская альтэрнатыўная сцэна).
- **Жанравая класіка:** Абавязкова ўключы ў выніковы спіс ~5 знакавых шлягераў з дамінуючага жанру, вызначанага з уваходных даных.
- **Лакальная сцэна:** Каля 30% выканаўцаў у фінальным спісе павінны быць з Беларусі.
- **Моўны фільтр:** Пазбягай песень на рускай мове, і **НІКОЛІ** не дадавай рускамоўных песень расейскіх выканаўцаў.
- **Напісанне назваў:** Для беларускіх гуртоў выкарыстоўвай найбольш распаўсюджанае ў публічнай прасторы напісанне іх назвы (кірыліца ці лацінка).

[Фармат вываду]:
- Адказ павінен быць ВЫКЛЮЧНА валідным JSON-масівам.
- Кожны элемент масіва — гэта радок у фармаце "Artist Name - Track Title".
- Не дадавай ніякіх тлумачэнняў, каментароў або markdown (напр., \`\`\` ці *) да або пасля JSON-блока.
- **ВЕЛЬМІ ВАЖНА ДЛЯ ДАКЛАДНАСЦІ ПОШУКУ:**
- **Чысціня радка:** Усе назвы павінны быць у ніжнім рэгістры.
- **Без спецыяльных сімвалаў:** Выдалі ўсе неалфавітна-лічбавыя сімвалы, такія як ()[]{}'’"“” і г.д., акрамя дэфіса ў назве.
- **Без метаданых:** Не дадавай словы 'remastered', 'live version', 'radio edit' і г.д. у назву трэка.

[Прыклад ідэальнага вываду]:
[
  "the cure - a forest",
  "joy division - disorder",
  "molchat doma - sudno borys ryzhyi",
  "lavon volski - pavietrany shar"
]
`;
}

// ===============================================================
//                     ГЕНЕРАЦЫЯ ВОКЛАДКІ
// ===============================================================

/**
 * Асноўная функцыя для генерацыі вокладкі плэйліста.
 * @param {Array<Object>} tracksForAnalysis Масіў трэкаў для аналізу настрою.
 * @return {string | null} Малюнак у фармаце Base64 або null.
 */
function generatePlaylistCover_(tracksForAnalysis) {
  if (!AI_CONFIG.IMAGE_GENERATION.ENABLED) {
    Logger.log('Генерацыя вокладкі выключана ў наладах.');
    return null;
  }

  if (!tracksForAnalysis || tracksForAnalysis.length === 0) {
    Logger.log('Плэйліст пусты, генерацыя вокладкі прапушчана.');
    return null;
  }

  try {
    const imagePrompt = createImagePromptFromTracks_(tracksForAnalysis);
    if (!imagePrompt) {
      Logger.log('Не атрымалася стварыць промпт для малюнка.');
      return null;
    }
    
    const originalImageBase64 = callHuggingFaceApi_(imagePrompt);
    if (!originalImageBase64) return null;
    
    // Спрабуем паменшыць малюнак для больш хуткай загрузкі ў Spotify
    return resizeImage_(originalImageBase64);
    
  } catch (error) {
    Logger.log(`⚠️ Падчас генерацыі вокладкі адбылася памылка: ${error.toString()}`);
    return null;
  }
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
[Role]: You are a professional art director and expert in creating effective prompts for AI image generators.
[Context]: I am giving you a list of music tracks. Analyze their combined mood and aesthetic to create a SINGLE, highly detailed, technically precise prompt for an AI to generate a square album cover.
[Input Data]:
${trackListString}
[Rules for the output prompt]:
- **Technical Quality:** Include keywords for high-quality images: "hyperrealistic", "8k resolution", "intricate details", "professional photography".
- **Style:** Suggest a specific, evocative visual style: "cinematic still", "lomography photo", "double exposure", "retro-futurism", "surrealism".
- **Lighting & Composition:** Describe lighting in detail: "cinematic lighting", "volumetric light", "moody lighting", "hard shadows".
- **Atmosphere:** Focus on abstract emotions and textures, not literal scenes.
- **Brevity:** The final prompt must be a single, concise paragraph under 120 words.
- **Language:** The prompt MUST be in English.
[Output Format]: ONLY the text of the prompt itself. No explanations, titles, or quotation marks.
[Example of a perfect output]:
Cinematic wide-angle shot of a lone, glowing figure in a rain-slicked, neon-lit alleyway. Moody, atmospheric lighting with long shadows and volumetric fog. Shot on a 35mm lens, shallow depth of field, Portra 400 film grain. Hyperrealistic, intricate details on the wet pavement. An atmosphere of melancholic solitude and urban decay.
`;

  try {
    const geminiApiKey = getGeminiApiKey_();
    // Выкарыстоўваем хуткую мадэль для генерацыі промпта
    const imagePromptText = callGeminiApi_(geminiApiKey, 'gemini-1.5-flash-latest', promptForPrompt); 
    return imagePromptText ? imagePromptText.replace(/[`"']/g, '') : null;
  } catch (e) {
    Logger.log(`Не атрымалася стварыць промпт для малюнка: ${e}`);
    return null;
  }
}

/**
 * Памяншае памер малюнка з дапамогай вонкавага сэрвісу weserv.nl.
 * @param {string} originalBase64 Малюнак у Base64.
 * @return {string} Паменшаны малюнак у Base64 або арыгінал у выпадку памылкі.
 */
function resizeImage_(originalBase64) {
  let tempFile = null;
  try {
    const imageBlob = Utilities.newBlob(Utilities.base64Decode(originalBase64), 'image/jpeg', 'temp_cover.jpg');
    tempFile = DriveApp.createFile(imageBlob);
    tempFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const imageUrlForResize = `https://drive.google.com/uc?id=${tempFile.getId()}`;
      
    Logger.log(`Спроба паменшыць малюнак праз weserv.nl...`);
    const resizeServiceUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrlForResize)}&w=600&h=600&q=90&output=jpg`;
    const resizedResponse = UrlFetchApp.fetch(resizeServiceUrl, { 'muteHttpExceptions': true });
      
    if (resizedResponse.getResponseCode() === 200) {
      Logger.log(`✅ Малюнак паспяхова паменшаны.`);
      return Utilities.base64Encode(resizedResponse.getBlob().getBytes());
    } else {
      Logger.log(`⚠️ Сэрвіс змены памеру малюнка не спрацаваў (Код: ${resizedResponse.getResponseCode()}). Выкарыстоўваецца арыгінальны малюнак.`);
      return originalBase64;
    }
  } catch (e) {
    Logger.log(`⚠️ Падчас змены памеру малюнка адбылася памылка: ${e}. Выкарыстоўваецца арыгінальны малюнак.`);
    return originalBase64;
  } finally {
    if (tempFile) {
      try { tempFile.setTrashed(true); Logger.log('Часовы файл вокладкі выдалены.'); }
      catch (e) { Logger.log(`Не атрымалася выдаліць часовы файл: ${e}`); }
    }
  }
}

// ===============================================================
//                       ДАПАМОЖНЫЯ ФУНКЦЫІ
// ===============================================================

/**
 * Нармалізуе радок з назвай трэка ад AI для максімальнай дакладнасці пошуку.
 * Уключае транслітарацыю з кірыліцы ў лацінку.
 * @param {string} rawQuery - Сыры радок ад AI.
 * @return {string} Ачышчаны і транслітараваны радок, гатовы для пошуку.
 */
function normalizeTrackQuery_(rawQuery) {
  if (typeof rawQuery !== 'string' || rawQuery.length === 0) return "";
  
  const TRANSLIT_TABLE = {
    'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z',
    'и':'i','й':'i','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p',
    'р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch',
    'ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'iu','я':'ia',
    'і':'i','ў':'u','ґ':'g','є':'ie','ї':'i'
  };

  let cleanedQuery = rawQuery.toLowerCase();
  cleanedQuery = cleanedQuery.split('').map(char => TRANSLIT_TABLE[char] || char).join('');
  cleanedQuery = cleanedQuery.replace(/\s*[\(\[].*?[\)\]]\s*/g, ' ').trim();
  const noiseWords = ['remastered', 'remaster', 'live', 'radio edit', 'album version', 'single version', 'bonus track'];
  noiseWords.forEach(word => {
    cleanedQuery = cleanedQuery.replace(new RegExp(`\\b${word}\\b`, 'gi'), '');
  });
  cleanedQuery = cleanedQuery.replace(/^the\s+/, '');
  cleanedQuery = cleanedQuery.replace(/[^a-z0-9\s-]/g, ' ').replace(/\s{2,}/g, ' ').trim();

  return cleanedQuery;
}

/**
 * Апрацоўвае сыры радок адказу ад Gemini, выпраўляючы распаўсюджаныя памылкі фарматавання.
 * @param {string} rawResponse - Сыры радок ад AI.
 * @return {Array<string>} Масіў трэкаў для пошуку.
 */
function parseAiResponse_(rawResponse) {
  let cleanedJsonString = rawResponse;
  cleanedJsonString = cleanedJsonString.replace(/^\s*[\*\-]\s*/gm, '');
  cleanedJsonString = cleanedJsonString.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  cleanedJsonString = cleanedJsonString.replace(/,\s*\]/g, ']');

  try {
    let tracks = JSON.parse(cleanedJsonString);
    if (!Array.isArray(tracks)) {
      throw new Error("Адказ AI не з'яўляецца масівам пасля ачысткі.");
    }
    const validTracks = tracks.filter(item => typeof item === 'string' && item.trim().length > 0);
    if (validTracks.length !== tracks.length) {
      Logger.log(`Папярэджанне: ${tracks.length - validTracks.length} несапраўдных або пустых элементаў было выдалена з адказу AI.`);
    }
    return validTracks;
  } catch (e) {
    Logger.log(`КРЫТЫЧНАЯ памылка парсінгу: ${e.message}`);
    Logger.log(`Сыры адказ быў: \n---\n${rawResponse}\n---`);
    Logger.log(`Ачышчаны радок быў: \n---\n${cleanedJsonString}\n---`);
    return [];
  }
}

function getGeminiApiKey_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    throw new Error("API-ключ 'GEMINI_API_KEY' не знойдзены ва ўласцівасцях скрыпта.");
  }
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
  // Дадаем responseSchema толькі калі мадэль гэта падтрымлівае
  if (model.includes('1.5')) {
      requestPayload.generationConfig.responseSchema = {"type": "array", "items": { "type": "string" }};
  }
  
  const options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(requestPayload), 'muteHttpExceptions': true };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();
    if (responseCode === 200) {
      const jsonResponse = JSON.parse(responseBody);
      if (jsonResponse.candidates && jsonResponse.candidates[0]?.content?.parts[0]?.text) {
         return jsonResponse.candidates[0].content.parts[0].text;
      } else {
         Logger.log(`API вярнуў код 200, але структура адказу нечаканая. Адказ: ${responseBody}`);
         return null;
      }
    } else {
      Logger.log(`Памылка выкліку Gemini API. Код: ${responseCode}. Адказ: ${responseBody}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Выключэнне падчас выкліку Gemini API: ${error}`);
    return null;
  }
}

/**
 * Выклікае Inference API Hugging Face.
 * @param {string} imagePrompt - Тэкставы запыт для генерацыі малюнка.
 * @return {string | null} - Малюнак у фармаце Base64 або null у выпадку памылкі.
 */
function callHuggingFaceApi_(imagePrompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('HUGGINGFACE_API_KEY');
  if (!apiKey) {
    Logger.log('Памылка: API-ключ для Hugging Face (HUGGINGFACE_API_KEY) не знойдзены.');
    return null;
  }
  
  const modelId = AI_CONFIG.IMAGE_GENERATION.SELECTED_MODEL_ID;
  const url = `https://api-inference.huggingface.co/models/${modelId}`;
  
  let payload = { "inputs": imagePrompt };
  
  // Спецыяльныя параметры для хуткіх мадэляў
  if (modelId.includes('FLUX.1-schnell') || modelId.includes('sdxl-turbo')) {
    payload.parameters = {
      "num_inference_steps": 8,
      "guidance_scale": 0.0
    };
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
    Logger.log(`Hugging Face: Адпраўка запыту на генерацыю ў мадэль "${modelId}"...`);
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();

    if (responseCode === 200) {
      Logger.log(`✅ Малюнак паспяхова згенераваны праз "${modelId}".`);
      const imageBlob = response.getBlob();
      return Utilities.base64Encode(imageBlob.getBytes());
    } else {
      const responseBody = response.getContentText();
      Logger.log(`Памылка выкліку Hugging Face API. Код: ${responseCode}. Адказ: ${responseBody}`);
      if (responseCode === 503) {
          Logger.log('Мадэль на Hugging Face зараз загружаецца. Гэта можа заняць некалькі хвілін. Запуск будзе паспяховым у наступны раз.');
      }
      return null;
    }
  } catch (error) {
    Logger.log(`Выключэнне падчас выкліку Hugging Face API: ${error}`);
    return null;
  }
}

// ===============================================================
//                  АПЦЫЯНАЛЬНАЯ ФУНКЦЫЯ АЧЫСТКІ
// ===============================================================

/**
 * [ПАЛЕПШАНАЯ ВЕРСІЯ] Гэту функцыю можна запускаць па раскладзе (напр., штогадзіны)
 * для выдалення трэкаў з мэтавага плэйліста, якія вы нядаўна праслухалі.
 */
function cleanUpPlaylist() {
  const playlistIdToClean = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
  Logger.log(`Задача ачысткі: Пачатак для плэйліста ID: ${playlistIdToClean}`);

  try {
    const currentPlaylistTracks = Source.getPlaylistTracks('', playlistIdToClean);
    if (!currentPlaylistTracks || currentPlaylistTracks.length === 0) {
      Logger.log(`Задача ачысткі: Плэйліст пусты. Завяршэнне.`);
      return;
    }
    const initialTrackCount = currentPlaylistTracks.length;
    Logger.log(`Знойдзена ${initialTrackCount} трэкаў у плэйлісце для праверкі.`);

    Logger.log(`Задача ачысткі: Атрыманне гісторыі праслухоўванняў за апошнія ${AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS} дзён...`);
    let recentTracksHistory = RecentTracks.get();
    Filter.rangeDateRel(recentTracksHistory, AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS, 0);
    
    if (!recentTracksHistory || recentTracksHistory.length === 0) {
        Logger.log(`Задача ачысткі: Не знойдзена праслуханых трэкаў за зададзены перыяд. Змены не патрабуюцца.`);
        return;
    }
    Logger.log(`Знойдзена ${recentTracksHistory.length} праслуханых трэкаў для параўнання.`);

    // Выкарыстоўваем Set для хуткага і надзейнага параўнання па ID трэкаў
    const recentTrackIds = new Set(recentTracksHistory.map(track => track.id));
    const tracksToKeep = currentPlaylistTracks.filter(track => !recentTrackIds.has(track.id));
    
    const tracksToRemoveCount = initialTrackCount - tracksToKeep.length;

    if (tracksToRemoveCount > 0) {
      Logger.log(`Задача ачысткі: ${tracksToRemoveCount} праслуханых трэкаў будзе выдалена. Застанецца ${tracksToKeep.length} трэкаў. Абнаўленне плэйліста...`);
      Playlist.saveWithReplace({ id: playlistIdToClean, tracks: tracksToKeep });
      Logger.log(`Задача ачысткі: Плэйліст паспяхова абноўлены.`);
    } else {
      Logger.log(`Задача ачысткі: Супадзенняў не знойдзена. Усе трэкі ў плэйлісце застаюцца. Змены не патрабуюцца.`);
    }
  } catch (error) {
    Logger.log(`ПАМЫЛКА задачы ачысткі: ${error.toString()}\nСтэк: ${error.stack}`);
  }
}
