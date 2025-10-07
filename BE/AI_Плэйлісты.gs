/**
 * @OnlyCurrentDoc
 * Галоўны файл для працы з Gemini AI для стварэння плэйлістоў Spotify.
 * Гэты скрыпт аналізуе вашу бібліятэку, атрымлівае рэкамендацыі ад AI і генеруе карыстальніцкія вокладкі.
 *
 * Версія: 2.0 (Незалежнасць ад мадыфікацый бібліятэкі, палепшаная дакладнасць пошуку)
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
  // 'gemini-2.5-pro' — магутная; 'gemini-2.5-flash' — больш хуткая.
  GEMINI_MODEL: 'gemini-2.5-pro',

  // Колькасць выпадковых трэкаў з вашай бібліятэкі для аналізу AI.
  // Большая выбарка дае AI лепшае разуменне вашых густаў. 700 — добры баланс.
  TRACK_SAMPLE_SIZE_FOR_AI: 700,

  // Максімальны памер фінальнага плэйліста.
  // Калі плэйліст стане большым, самыя старыя трэкі будуць выдалены.
  MAX_PLAYLIST_SIZE: 500,

  // Шаблон для назвы плэйліста. {date} будзе заменена на бягучую дату.
  PLAYLIST_NAME_TEMPLATE: 'AI Плэйліст ад {date}',

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

    // <<< --- НОВЫ КРОК НАРМАЛІЗАЦЫІ --- >>>
    Logger.log('Нармалізацыя запытаў перад адпраўкай у Spotify...');
    const normalizedTracksToSearch = tracksToSearch.map(track => normalizeTrackQuery_(track));

    Logger.log(`Пошук ${normalizedTracksToSearch.length} трэкаў на Spotify...`);
    let foundSpotifyTracks = Search.multisearchTracks(normalizedTracksToSearch);
    Logger.log(`Знойдзена ${foundSpotifyTracks.length} трэкаў на Spotify.`);

    if (foundSpotifyTracks.length === 0) {
      Logger.log('Не знойдзена ніводнага трэка на Spotify па рэкамендацыях AI. Спыненне выканання.');
      return;
    }

    updatePlaylistIncrementally_(foundSpotifyTracks);

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
 * Інкрэментальна абнаўляе плэйліст: дадае новыя трэкі, абразае старыя і ўсталёўвае новую вокладку.
 * @param {Array<Object>} foundSpotifyTracks Масіў трэкаў, рэкамендаваных AI.
 */
function updatePlaylistIncrementally_(foundSpotifyTracks) {
  Logger.log(`Атрыманне існуючых трэкаў з плэйліста ID: ${AI_CONFIG.SPOTIFY_PLAYLIST_ID}...`);
  const existingPlaylistTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  
  let newUniqueTracks = Selector.sliceCopy(foundSpotifyTracks);
  Filter.removeTracks(newUniqueTracks, existingPlaylistTracks);
  Logger.log(`Знойдзена ${newUniqueTracks.length} новых, унікальных трэкаў для дадавання.`);

  if (newUniqueTracks.length === 0) {
    Logger.log('Няма новых трэкаў для дадавання. Плэйліст застаецца без змен.');
    return;
  }

  let finalTrackList = [];
  Combiner.push(finalTrackList, newUniqueTracks, existingPlaylistTracks);
  Logger.log(`Агульная колькасць трэкаў пасля аб'яднання: ${finalTrackList.length}.`);

  if (finalTrackList.length > AI_CONFIG.MAX_PLAYLIST_SIZE) {
    const tracksToRemoveCount = finalTrackList.length - AI_CONFIG.MAX_PLAYLIST_SIZE;
    Logger.log(`Плэйліст перавышае ліміт у ${AI_CONFIG.MAX_PLAYLIST_SIZE} трэкаў. Выдаленне ${tracksToRemoveCount} самых старых...`);
    finalTrackList.length = AI_CONFIG.MAX_PLAYLIST_SIZE; // Проста абразаем масіў
  }

  Logger.log('Спроба згенераваць і апрацаваць новую вокладку...');
  let coverImageBase64 = null;
  let tempFile = null;

  try {
    const originalImageBase64 = generatePlaylistCover_(finalTrackList);
    if (originalImageBase64) {
      const imageBlob = Utilities.newBlob(Utilities.base64Decode(originalImageBase64), 'image/jpeg', 'temp_cover.jpg');
      tempFile = DriveApp.createFile(imageBlob);
      tempFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      const imageUrlForResize = `https://drive.google.com/uc?id=${tempFile.getId()}`;
      
      Logger.log(`Спроба паменшыць малюнак праз weserv.nl...`);
      const resizeServiceUrl = `https://images.weserv.nl/?url=${encodeURIComponent(imageUrlForResize)}&w=600&h=600&q=90&output=jpg`;
      const resizedResponse = UrlFetchApp.fetch(resizeServiceUrl, { 'muteHttpExceptions': true });
      
      if (resizedResponse.getResponseCode() === 200) {
        coverImageBase64 = Utilities.base64Encode(resizedResponse.getBlob().getBytes());
        Logger.log(`✅ Малюнак паспяхова паменшаны.`);
      } else {
        Logger.log(`⚠️ Сэрвіс змены памеру малюнка не спрацаваў (Код: ${resizedResponse.getResponseCode()}). Абнаўленне вокладкі прапушчана.`);
      }
    }
  } catch (e) {
    Logger.log(`⚠️ Падчас апрацоўкі вокладкі адбылася памылка: ${e}.`);
  } finally {
    if (tempFile) {
      try { tempFile.setTrashed(true); Logger.log('Часовы файл вокладкі выдалены.'); }
      catch (e) { Logger.log(`Не атрымалася выдаліць часовы файл: ${e}`); }
    }
  }

  const playlistName = AI_CONFIG.PLAYLIST_NAME_TEMPLATE.replace('{date}', new Date().toLocaleDateString('be-BY'));
  const formattedDateTime = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMMM yyyy, HH:mm');

  const playlistData = {
    id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
    name: playlistName,
    tracks: finalTrackList,
    description: `Апошняе абнаўленне: ${formattedDateTime}. Дададзена: ${newUniqueTracks.length} новых. Агулам: ${finalTrackList.length}.`,
    coverImage: coverImageBase64
  };

  Logger.log(`Захаванне ${finalTrackList.length} трэкаў ${coverImageBase64 ? 'і новай вокладкі' : ''} ў плэйліст "${playlistName}"...`);
  savePlaylistWithBase64Cover_(playlistData);
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

function generatePlaylistCover_(tracks) {
  try {
    const imagePrompt = createImagePromptFromTracks_(tracks);
    if (!imagePrompt) {
      Logger.log('Не атрымалася стварыць промпт для малюнка.');
      return null;
    }
    Logger.log(`Згенераваны промпт для малюнка: "${imagePrompt}"`);
    return callGeminiImageGenerationApi_(imagePrompt);
  } catch (error) {
    Logger.log(`Памылка падчас генерацыі вокладкі: ${error}`);
    return null;
  }
}

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
    const imagePromptText = callGeminiApi_(geminiApiKey, 'gemini-2.5-flash', promptForPrompt); 
    return imagePromptText ? imagePromptText.replace(/`/g, '') : null;
  } catch (e) {
    Logger.log(`Не атрымалася стварыць промпт для малюнка: ${e}`);
    return null;
  }
}

// ===============================================================
//                       ДАПАМОЖНЫЯ ФУНКЦЫІ
// ===============================================================

/**
 * [НОВАЯ - НЕЗАЛЕЖНАЯ] Захоўвае плэйліст, выкарыстоўваючы стандартныя функцыі Goofy,
 * а затым асобна загружае вокладку ў Base64. Гэта дазваляе не змяняць бібліятэку.
 * @param {object} data - Аб'ект з данымі плэйліста (id, name, tracks, description, coverImage).
 */
function savePlaylistWithBase64Cover_(data) {
  Logger.log('Выкананне стандартнага захавання трэкаў і метаданых...');
  Playlist.saveWithReplace({
    id: data.id,
    name: data.name,
    description: data.description,
    tracks: data.tracks
  });

  if (data.coverImage) {
    Logger.log('Знойдзена вокладка ў фармаце Base64. Спроба загрузкі...');
    try {
      SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${data.id}/images`, data.coverImage);
      Logger.log('✅ Вокладка паспяхова загружана.');
    } catch (e) {
      Logger.log(`⚠️ Памылка падчас загрузкі вокладкі: ${e.toString()}`);
    }
  }
}

/**
 * [НОВАЯ - НАРМАЛІЗАТАР] Нармалізуе радок з назвай трэка ад AI для максімальнай дакладнасці пошуку.
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
  cleanedQuery = cleanedQuery.replace(/[^a-z0-9\s]/g, ' ').replace(/\s{2,}/g, ' ').trim();

  return cleanedQuery;
}

/**
 * [ПАЛЕПШАНАЯ] Апрацоўвае сыры радок адказу ад Gemini, выпраўляючы распаўсюджаныя памылкі фарматавання.
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
       "responseMimeType": "application/json",
       "responseSchema": {"type": "array", "items": { "type": "string" }}
     },
     "safetySettings": [
        { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
        { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
      ]
   };
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

function callGeminiImageGenerationApi_(imagePrompt) {
  const apiKey = getGeminiApiKey_();
  const model = 'gemini-2.0-flash-preview-image-generation';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;
  const requestPayload = {
    "contents": [{"parts": [{ "text": `Generate a single, high-quality, photorealistic square album cover based strictly on the following creative description: ${imagePrompt}` }]}],
    "generationConfig": { "responseModalities": ["IMAGE", "TEXT"] }
  };
  const options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(requestPayload), 'muteHttpExceptions': true };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();
    if (responseCode === 200) {
      const chunks = JSON.parse(responseBody);
      for (const chunk of chunks) {
        if (chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
          Logger.log('✅ Даныя малюнка знойдзены ў адказе API.');
          return chunk.candidates[0].content.parts[0].inlineData.data;
        }
      }
      Logger.log(`API вярнуў код 200, але даныя малюнка не знойдзены. Адказ: ${responseBody}`);
      return null;
    } else {
      Logger.log(`Памылка выкліку Image API. Код: ${responseCode}. Адказ: ${responseBody}`);
      return null;
    }
  } catch (error) {
    Logger.log(`Выключэнне падчас выкліку Image API: ${error}`);
    return null;
  }
}

// ===============================================================
//                  АПЦЫЯНАЛЬНАЯ ФУНКЦЫЯ АЧЫСТКІ
// ===============================================================

/**
 * Гэту функцыю можна запускаць па раскладзе (напр., штогадзіны) для выдалення
 * трэкаў з мэтавага плэйліста, якія вы нядаўна праслухалі.
 */
function cleanUpPlaylist() {
  const playlistIdToClean = AI_CONFIG.SPOTIFY_PLAYLIST_ID;
  Logger.log(`Задача ачысткі: Пачатак для плэйліста ID: ${playlistIdToClean}`);

  try {
    let currentPlaylistTracks = Source.getPlaylistTracks('', playlistIdToClean);
    if (!currentPlaylistTracks || currentPlaylistTracks.length === 0) {
      Logger.log(`Задача ачысткі: Плэйліст пусты. Завяршэнне.`);
      return;
    }
    const initialTrackCount = currentPlaylistTracks.length;

    Logger.log(`Задача ачысткі: Атрыманне гісторыі праслухоўванняў за апошнія ${AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS} дзён...`);
    let recentTracksHistory = RecentTracks.get();
    Filter.rangeDateRel(recentTracksHistory, AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS, 0);
    
    Filter.removeTracks(currentPlaylistTracks, recentTracksHistory);
    const finalTrackCount = currentPlaylistTracks.length;

    if (finalTrackCount < initialTrackCount) {
      Logger.log(`Задача ачысткі: ${initialTrackCount - finalTrackCount} трэкаў будзе выдалена. Абнаўленне плэйліста...`);
      Playlist.saveWithReplace({ id: playlistIdToClean, tracks: currentPlaylistTracks });
      Logger.log(`Задача ачысткі: Плэйліст паспяхова абноўлены.`);
    } else {
      Logger.log(`Задача ачысткі: Праслуханыя трэкі не знойдзены ў плэйлісце. Змены не патрабуюцца.`);
    }
  } catch (error) {
    Logger.log(`ПАМЫЛКА задачы ачысткі: ${error}`);
  }
}
