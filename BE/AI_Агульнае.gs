/**
 * @OnlyCurrentDoc
 * AI_Агульнае - Цэнтральнае сховішча глабальных налад і агульных функцый AI/Пошуку.
 */

// =========================================================================
// 1. ГЛАБАЛЬНЫЯ НАЛАДЫ AI
// =========================================================================
const GLOBAL_AI_CONFIG = {
  // Спіс мадэляў Gemini для генерацыі тэксту (ад лепшай да самай хуткай)
  TEXT_MODELS_PRIORITY:[
    'gemini-3.1-pro-preview',
    'gemini-3-pro-preview',
    'gemini-2.5-pro',
    'gemini-3-flash-preview',
    'gemini-2.5-flash',
    'gemini-flash-latest'
  ],

  // Налады генерацыі вокладак
  IMAGE: {
    ENABLED: true,
    GEMINI_MODEL: "gemini-3.1-flash-image-preview", 
    GEMINI_MODELS_PRIORITY:[
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image-preview',
      'gemini-2.5-flash-image'
    ], 
    POLLINATIONS_MODEL: 'flux' // Рэзервовая мадэль
  }  
};

// =========================================================================
// 2. РУХАВІК ТЭКСТАВАГА AI (GEMINI)
// =========================================================================

function getGeminiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) throw new Error("API ключ 'GEMINI_API_KEY' не знойдзены ва ўласцівасцях скрыпта.");
  return key;
}

/**
 * Універсальны зварот да Gemini для атрымання JSON-масіва трэкаў.
 * Праходзіць па спісе мадэляў, пакуль не атрымае адказ.
 */
function callGeminiTextAPI(promptText) {
  const apiKey = getGeminiKey_();
  let aiResponse = null;
  let usedModel = '';

  for (const modelName of GLOBAL_AI_CONFIG.TEXT_MODELS_PRIORITY) {
    Logger.log(`🔄 Спроба выкліку мадэлі: "${modelName}"...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    const payload = {
       "contents": [{"parts":[{"text": promptText}]}],
       "generationConfig": {
         "temperature": 1.1,
         "responseMimeType": "application/json"
       },
       "safetySettings":[
          { "category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE" },
          { "category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE" },
          { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
          { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
        ]
     };

    const options = { 
      'method': 'post', 
      'contentType': 'application/json', 
      'payload': JSON.stringify(payload), 
      'muteHttpExceptions': true 
    };

    try {
      const response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() === 200) {
        const json = JSON.parse(response.getContentText());
        if (json.candidates && json.candidates[0].content) {
          aiResponse = json.candidates[0].content.parts[0].text;
          usedModel = modelName;
          Logger.log(`✅ Мадэль "${modelName}" паспяхова згенеравала спіс.`);
          break; // Поспех!
        }
      } else {
        Logger.log(`⚠️ Мадэль "${modelName}" недаступная (Код: ${response.getResponseCode()}). Пераход да наступнай...`);
        Utilities.sleep(1000);
      }
    } catch (e) {
      Logger.log(`⚠️ Памылка злучэння з мадэллю "${modelName}": ${e}`);
    }
  }

  if (!aiResponse) throw new Error('❌ Усе мадэлі Gemini недаступныя.');
  
  return { responseText: aiResponse, model: usedModel };
}

/**
 * Ачышчае і распаршвае адказ ад AI.
 */
function parseAiResponse(rawResponse) {
  let cleanedJson = rawResponse.replace(/^[\s\S]*?\[/, '[').replace(/\][\s\S]*$/, ']');
  try {
    let tracks = JSON.parse(cleanedJson);
    if (!Array.isArray(tracks)) throw new Error("Гэта не масіў");
    return tracks.filter(item => typeof item === 'string' && item.trim().length > 0);
  } catch (e) {
    Logger.log(`❌ Памылка парсінгу адказу: ${e.message}\nСыры адказ: ${rawResponse}`);
    return[];
  }
}

// =========================================================================
// 3. РУХАВІК ВЫЯЎ (ВОКЛАДКІ)
// =========================================================================

/**
 * Галоўная функцыя генерацыі і прымянення вокладкі.
 */
function generateAndApplyCover(playlistId, tracks) {
  if (!GLOBAL_AI_CONFIG.IMAGE.ENABLED) return;
  
  Logger.log('🎨 Пачатак генерацыі вокладкі...');
  const prompt = buildImagePrompt_(tracks);
  if (!prompt) return;

  // Запуск каскаднага перабору мадэляў Gemini
  let coverBase64 = callGeminiImageGen_(prompt);
  
  // Калі ўсе Gemini-мадэлі праваліліся, пераходзім на рэзервовы API
  if (!coverBase64) {
    Logger.log('⚠️ Усе мадэлі Gemini недаступныя. Пераход на рэзервовы генератар выяў (Pollinations)...');
    coverBase64 = callPollinationsImageGen_(prompt);
  }

  if (coverBase64) {
    Logger.log('Загрузка новай вокладкі ў Spotify...');
    try {
      SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${playlistId}/images`, coverBase64);
      Logger.log('✅ Вокладка паспяхова загружана.');
    } catch (e) {
      Logger.log(`⚠️ Памылка загрузкі вокладкі: ${e.toString()}`);
    }
  } else {
    Logger.log('❌ Не атрымалася згенераваць вокладку ніводнай з даступных мадэляў.');
  }
}

function buildImagePrompt_(tracks) {
  const trackSample = Selector.sliceRandom(tracks, 50).map(t => `${t.artists[0].name} - ${t.name}`).join('\n');
  const instruction  = `
<system_instruction>
    <role>
        You are an Elite Synesthetic Art Director and Master Prompt Engineer for Text-to-Image AI models. Your unparalleled expertise lies in translating the acoustic, rhythmic, and emotional signature of music into breathtaking visual concepts. You do not depict music literally; you feel it as architecture, light, color, and abstraction.
    </role>
    <objective>
        Analyze the emotional weight, tempo, and genre implications of the provided 50-track playlist, and synthesize its core "vibe" into a single, masterfully crafted text-to-image prompt for a square album cover.
    </objective>
    <context_awareness>
        Treat the following tracklist not as text, but as an emotional landscape.
        [Input Tracks]:
        ${trackSample}
    </context_awareness>
    <behavioral_guidelines>
        1. **Conceptual Core:** Build the prompt around a central, evocative metaphor or abstract scene.
        2. **Artistic Direction (Choose ONE):** Select a bold, definitive visual style. Do not default to generic photorealism. Choose from: Photography, Abstract expressionism, Surrealism, Digital/Glitch art.
        3. **Composition & Lighting:** Specify the spatial arrangement and exact lighting conditions.
        4. **Color Palette:** Define a strict, descriptive color scheme.
        5. **Technical Polish:** Conclude the prompt with 2-3 precise technical keywords matching the chosen style.
    </behavioral_guidelines>
    <strict_constraints>
        * **NO LITERAL TRANSLATIONS:** NEVER include musical instruments, notes, or artist names.
        * **FORMAT & LENGTH:** Output MUST be exactly one paragraph under 140 words.
        * **RAW OUTPUT:** Output ONLY the raw image prompt. No JSON, no brackets, no introductory words.
    </strict_constraints>
</system_instruction>
`;
  
  try {
    const result = callGeminiTextAPI(instruction);
    let prompt = result.responseText.replace(/```json|```/g, '').trim();
    
    // Разумная ачыстка: калі мадэль усё ж вярнула масіў або аб'ект
    try {
      const parsed = JSON.parse(prompt);
      if (parsed.prompt) {
        prompt = parsed.prompt;
      } else if (Array.isArray(parsed) && parsed.length > 0) {
        prompt = parsed[0]; // Бярэм першы элемент масіву
      }
    } catch(e) {} // Калі не парсіцца, значыць гэта і так чысты тэкст
    
    Logger.log(`✅ Промпт для вокладкі створаны: "${prompt.substring(0, 50)}..."`);
    return prompt;
  } catch (e) {
    Logger.log(`⚠️ Не ўдалося стварыць промпт для выявы: ${e.toString()}`);
    return null;
  }
}

function callGeminiImageGen_(prompt) {
  const apiKey = getGeminiKey_();

  for (const modelName of GLOBAL_AI_CONFIG.IMAGE.GEMINI_MODELS_PRIORITY) {
    Logger.log(`🎨 Спроба генерацыі выявы праз мадэль: "${modelName}"...`);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    
    // АБНАЎЛЕННЕ: Выкарыстоўваем '1K' для новых мадэляў (3.1/3.0) і адключаем imageSize для старых.
    // Параметр aspectRatio "1:1" разумеюць усе мадэлі.
    let imageConfig = { "aspectRatio": "1:1" };
    if (modelName.includes('3.1') || modelName.includes('3-pro')) {
      imageConfig["imageSize"] = "1K"; 
    }

    const payload = {
      "contents": [{ "parts":[{ "text": prompt }] }],
      "generationConfig": {
        "responseModalities": ["IMAGE"],
        "imageConfig": imageConfig
      }
    };

    const options = { 
      'method': 'post', 
      'contentType': 'application/json', 
      'payload': JSON.stringify(payload), 
      'muteHttpExceptions': true 
    };

    try {
      const response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() === 200) {
        const data = JSON.parse(response.getContentText());
        const imagePart = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
        if (imagePart?.inlineData?.data) {
          // Сцісканне PNG -> JPEG
          let originalBlob = Utilities.newBlob(Utilities.base64Decode(imagePart.inlineData.data), 'image/png');
          let jpegBlob = originalBlob.getAs('image/jpeg');
          Logger.log(`✅ Вокладка паспяхова створана мадэллю "${modelName}". Памер: ~${Math.round(jpegBlob.getBytes().length / 1024)} KB`);
          return Utilities.base64Encode(jpegBlob.getBytes());
        }
      } else {
        Logger.log(`⚠️ Мадэль "${modelName}" недаступная (Код: ${response.getResponseCode()}). Адказ: ${response.getContentText()}`);
        Utilities.sleep(1500); 
      }
    } catch (e) {
      Logger.log(`⚠️ Памылка злучэння з мадэллю "${modelName}": ${e.toString()}`);
    }
  }
  
  return null; 
}

function callPollinationsImageGen_(prompt) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&model=${GLOBAL_AI_CONFIG.IMAGE.POLLINATIONS_MODEL}&seed=${Math.floor(Math.random() * 1000000)}&nologo=true`;
  try {
    const response = UrlFetchApp.fetch(url, { 'muteHttpExceptions': true });
    if (response.getResponseCode() === 200) {
      return Utilities.base64Encode(response.getBlob().getBytes());
    }
    return null;
  } catch (e) { return null; }
}

// =========================================================================
// 4. БРОНЕБІТНЫ ПОШУК SPOTIFY
// =========================================================================

function executeSmartSearch(rawAiTracks) {
  if (!rawAiTracks || rawAiTracks.length === 0) return[];
  let allFoundTracks = [], notFoundQueries =[];

  Logger.log('\n--- УЗРОВЕНЬ 1: Пошук па арыгінале ---');
  let stage1Results = fetchSpotifyTracksCustom_(rawAiTracks);
  let stage2Queries = [], stage2Originals =[];

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

  if (stage2Queries.length > 0) {
    Logger.log(`\n--- УЗРОВЕНЬ 2: Транслітарацыя (${stage2Queries.length} трэкаў) ---`);
    let stage2Results = fetchSpotifyTracksCustom_(stage2Queries);
    let stage3Originals = [], stage3Queries =[];

    for (let i = 0; i < stage2Queries.length; i++) {
      let match = findBestMatchCustom_(stage2Queries[i], stage2Results[i], stage2Originals[i]);
      if (match) {
        allFoundTracks.push(match);
        Logger.log(`✅ [Узр 2] Знайшлі: "${stage2Originals[i]}" -> ${match.artists[0].name} - ${match.name}`);
      } else {
        stage3Originals.push(stage2Originals[i]);
        let parts = stage2Queries[i].split('-');
        stage3Queries.push(parts.length > 1 ? parts[1].trim() : stage2Queries[i]);
      }
    }

    if (stage3Queries.length > 0) {
      Logger.log(`\n--- УЗРОВЕНЬ 3: Толькі назва песні (${stage3Queries.length} трэкаў) ---`);
      let stage3Results = fetchSpotifyTracksCustom_(stage3Queries);
      for (let i = 0; i < stage3Queries.length; i++) {
        let match = findBestMatchCustom_(stage3Queries[i], stage3Results[i], stage3Originals[i], true);
        if (match) {
          allFoundTracks.push(match);
          Logger.log(`✅[Узр 3] Знайшлі: "${stage3Originals[i]}" -> ${match.artists[0].name} - ${match.name}`);
        } else {
          notFoundQueries.push(stage3Originals[i]);
        }
      }
    }
  }

  const uniqueTracks =[];
  const seenIds = new Set();
  allFoundTracks.forEach(t => {
    if (!seenIds.has(t.id)) { seenIds.add(t.id); uniqueTracks.push(t); }
  });

  if (notFoundQueries.length > 0) {
    Logger.log(`\n⚠️ Не знойдзена (галюцынацыі): ${notFoundQueries.length} трэкаў.`);
  }

  return uniqueTracks;
}

function fetchSpotifyTracksCustom_(queries) {
  let urls = queries.map(q => `https://api.spotify.com/v1/search?q=${encodeURIComponent(q.substring(0, 100))}&type=track&limit=5`);
  return SpotifyRequest.getAll(urls).map(res => {
    if (res && res.tracks && res.tracks.items) return res.tracks.items;
    if (res && res.items) return res.items;
    return[];
  });
}

/**
 * Разумны пошук найлепшага супадзення з АСОБНАЙ праверкай артыста і назвы
 */
function findBestMatchCustom_(query, tracks, originalQuery = null, isTitleOnly = false) {
  if (!tracks || tracks.length === 0) return null;

  let bestTrack = null;
  let bestScore = 0;

  // 1. Спрабуем разбіць арыгінальны запыт на Артыста і Назву (па дэфісе)
  let baseQuery = originalQuery || query;
  let queryParts = baseQuery.split('-');
  
  let qArtist = queryParts.length > 1 ? normalizeStrictCustom_(queryParts[0]) : "";
  let qTitle = queryParts.length > 1 ? normalizeStrictCustom_(queryParts.slice(1).join('-')) : normalizeStrictCustom_(baseQuery);
  let qNormFull = normalizeStrictCustom_(query);

  for (let i = 0; i < Math.min(tracks.length, 5); i++) {
    let track = tracks[i];
    if (!track || !track.artists || track.artists.length === 0) continue;

    let tArtist = normalizeStrictCustom_(track.artists[0].name);
    let tTitle = normalizeStrictCustom_(track.name);
    let tNormFull = normalizeStrictCustom_(`${track.artists[0].name} ${track.name}`);

    // --- АНТЫ-КАВЕР ФІЛЬТР ---
    // Калі ў нашым запыце не было слова cover/karaoke/tribute, адхіляем такія вынікі ад Spotify
    let rawTrackName = track.name.toLowerCase();
    let rawQuery = baseQuery.toLowerCase();
    if (!rawQuery.includes("cover") && !rawQuery.includes("karaoke") && !rawQuery.includes("tribute")) {
        if (rawTrackName.includes("karaoke") || rawTrackName.includes("tribute") || 
            track.artists[0].name.toLowerCase().includes("karaoke") || 
            track.artists[0].name.toLowerCase().includes("tribute")) {
            continue; // Прапускаем гэты трэк
        }
    }

    let score = 0;

    // --- ПААСОБНАЯ АЦЭНКА ---
    if (qArtist && qTitle) {
        let artistScore = compareStringsCustom_(qArtist, tArtist);
        let titleScore = compareStringsCustom_(qTitle, tTitle);

        // ЖОРСТКІ ФІЛЬТР АРТЫСТА: Калі артыст не супадае нават часткова
        if (artistScore < 0.4 && !tArtist.includes(qArtist) && !qArtist.includes(tArtist)) {
            continue; // Адсякае "ДДТ" замест "РЭХА", "mgk" замест "My Bloody Valentine"
        }

        // ЖОРСТКІ ФІЛЬТР НАЗВЫ: Калі назва не супадае зусім (ратуе ад Naviband - Куты -> Мама)
        if (titleScore < 0.4 && !tTitle.includes(qTitle) && !qTitle.includes(tTitle)) {
            continue; 
        }

        // Калі абодва фільтры пройдзеныя, лічым агульны бал (назва песні крыху важнейшая за імя артыста)
        score = (artistScore * 0.45) + (titleScore * 0.55);
    } else {
        // Калі не ўдалося разбіць па дэфісе (запыт з 1 слова), лічым агульны бал
        score = compareStringsCustom_(qNormFull, tNormFull);
    }

    // --- ШТРАФ ДЛЯ 3-га УЗРОЎНЮ ---
    if (isTitleOnly && originalQuery) {
      if (qArtist && !tArtist.includes(qArtist) && !qArtist.includes(tArtist)) {
        score -= 0.5; // Скідваем бал, калі шукалі па назве, але гурт увогуле левы
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestTrack = track;
    }
  }

  // Падымаем мінімальны парог з 0.50 да 0.65 (65% супадзення), каб дакладна адсеяць смецце
  return bestScore >= 0.65 ? bestTrack : null;
}

function normalizeStrictCustom_(str) {
  if (!str) return "";
  let s = str.toLowerCase().replace(/\s*[\(\[].*?[\)\]]\s*/g, ''); 
  s = translitCyrillicToLatinCustom_(s);
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '');
}

function translitCyrillicToLatinCustom_(text) {
  if (!text) return "";
  const map = { 'а':'a','б':'b','в':'v','г':'h','д':'d','е':'je','ё':'jo','ж':'zh','з':'z','і':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ў':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ы':'y','ь':'','э':'e','ю':'ju','я':'ja','ґ':'g' };
  return text.split('').map(char => map[char] || char).join('');
}

function compareStringsCustom_(first, second) {
  first = first.replace(/\s+/g, ''); second = second.replace(/\s+/g, '');
  if (first === second) return 1; 
  if (first.length < 2 || second.length < 2) return 0; 
  let firstBigrams = new Map();
  for (let i = 0; i < first.length - 1; i++) {
    const bigram = first.substring(i, i + 2);
    firstBigrams.set(bigram, (firstBigrams.get(bigram) || 0) + 1);
  }
  let intersectionSize = 0;
  for (let i = 0; i < second.length - 1; i++) {
    const bigram = second.substring(i, i + 2);
    const count = firstBigrams.get(bigram) || 0;
    if (count > 0) { firstBigrams.set(bigram, count - 1); intersectionSize++; }
  }
  return (2.0 * intersectionSize) / (first.length + second.length - 2);
}




// =========================================================================
// 5. УНІВЕРСАЛЬНАЯ АЧЫСТКА ПЛЭЙЛІСТОЎ
// =========================================================================

// =========================================================================
// 5. УНІВЕРСАЛЬНАЯ АЧЫСТКА ПЛЭЙЛІСТОЎ
// =========================================================================

/**
 * Выдаляе з плэйліста трэкі, якія былі праслуханыя за апошнія N дзён.
 * КРОПКАВАЕ ВЫДАЛЕННЕ (Не перазапісвае ўвесь плэйліст, каб захаваць даты дадання).
 * @param {string} playlistId - ID плэйліста ў Spotify
 * @param {number} days - Колькасць дзён гісторыі для аналізу
 */
function cleanPlaylistFromRecentTracks(playlistId, days) {
  if (!playlistId) {
    Logger.log('❌ Памылка: ID плэйліста не зададзены.');
    return;
  }
  
  Logger.log(`🧹 Пачатак ачысткі плэйліста (ID: ${playlistId}). Аналіз за апошнія ${days} дзён...`);
  
  try {
    const currentTracks = Source.getPlaylistTracks('', playlistId);
    if (!currentTracks || currentTracks.length === 0) {
      Logger.log('ℹ️ Плэйліст пусты. Ачыстка не патрабуецца.');
      return;
    }
    
    // Атрымліваем гісторыю праслухоўванняў (з кэшу goofy)
    let recentTracks = RecentTracks.get(); 
    if (!recentTracks || recentTracks.length === 0) {
      Logger.log('ℹ️ Гісторыя праслухоўванняў пустая.');
      return;
    }
    
    // Фільтруем гісторыю па даце (адсякаем усё, што старэй за ўказаныя дні)
    Filter.rangeDateRel(recentTracks, days, 0);
    const recentIds = new Set(recentTracks.map(t => t.id));
    
    // Знаходзім ТРЭКІ ДЛЯ ВЫДАЛЕННЯ (тыя, што ёсць і ў плэйлісце, і ў гісторыі)
    const tracksToRemove = currentTracks.filter(t => recentIds.has(t.id));
    
    if (tracksToRemove.length > 0) {
      Logger.log(`🗑️ Знойдзена ${tracksToRemove.length} праслуханых трэкаў. Выдаляем толькі іх...`);
      
      // Фарміруем масіў аб'ектаў для выдалення патрабаванага фармату Spotify
      const urisToDelete = tracksToRemove.map(t => ({ uri: t.uri || `spotify:track:${t.id}` }));
      
      // Выдаляем часткамі па 100 трэкаў (ліміт API Spotify)
      for (let i = 0; i < urisToDelete.length; i += 100) {
          const chunk = urisToDelete.slice(i, i + 100);
          SpotifyRequest.deleteRequest(`${API_BASE_URL}/playlists/${playlistId}/tracks`, { tracks: chunk });
      }
      
      Logger.log(`✅ Ачыстка кропкава завершана. Выдалена: ${tracksToRemove.length} трэкаў.`);
    } else {
      Logger.log('✅ Супадзенняў не знойдзена. Усе трэкі "свежыя", нічога не выдалена.');
    }
  } catch (e) {
    Logger.log(`❌ Памылка пры ачыстцы: ${e.toString()}`);
  }
}

/* function cleanPlaylistFromRecentTracks(playlistId, days) {
  if (!playlistId) {
    Logger.log('❌ Памылка: ID плэйліста не зададзены.');
    return;
  }
  
  Logger.log(`🧹 Пачатак ачысткі плэйліста (ID: ${playlistId}). Аналіз за апошнія ${days} дзён...`);
  
  try {
    const currentTracks = Source.getPlaylistTracks('', playlistId);
    if (!currentTracks || currentTracks.length === 0) {
      Logger.log('ℹ️ Плэйліст пусты. Ачыстка не патрабуецца.');
      return;
    }
    
    const initialCount = currentTracks.length;
    Logger.log(`У плэйлісце знойдзена ${initialCount} трэкаў.`);
    
    // Атрымліваем гісторыю праслухоўванняў (з кэшу goofy)
    let recentTracks = RecentTracks.get(); 
    if (!recentTracks || recentTracks.length === 0) {
      Logger.log('ℹ️ Гісторыя праслухоўванняў пустая.');
      return;
    }
    
    // Фільтруем гісторыю па даце (адсякаем усё, што старэй за ўказаныя дні)
    Filter.rangeDateRel(recentTracks, days, 0);
    
    // Ствараем Set для хуткага пошуку праслуханых ID
    const recentIds = new Set(recentTracks.map(t => t.id));
    
    // Пакідаем толькі тыя трэкі, якія НЕ сустракаюцца ў гісторыі
    const tracksToKeep = currentTracks.filter(t => !recentIds.has(t.id));
    const finalCount = tracksToKeep.length;
    const removedCount = initialCount - finalCount;
    
    if (removedCount > 0) {
      Logger.log(`🗑️ Знойдзена ${removedCount} праслуханых трэкаў. Выдаляем...`);
      Playlist.saveWithReplace({
        id: playlistId,
        tracks: tracksToKeep
      });
      Logger.log(`✅ Ачыстка завершана. Засталося трэкаў: ${finalCount}`);
    } else {
      Logger.log('✅ Супадзенняў не знойдзена. Усе трэкі "свежыя", нічога не выдалена.');
    }
  } catch (e) {
    Logger.log(`❌ Памылка пры ачыстцы: ${e.toString()}`);
  }
} */

// =========================================================================
// 6. ІНТЭГРАЦЫЯ FLOWSORT (РАЗУМНАЕ САРТАВАННЕ)
// =========================================================================

/**
 * Прымяняе алгарытм FlowSort да ўсяго плэйліста.
 * @param {string} playlistId - ID плэйліста ў Spotify
 * @param {string} preset - Назва прэсета ('atmospheric', 'drive', 'radio')
 */
function applySmartSort(playlistId, preset = 'atmospheric') {
  if (!playlistId) return;
  Logger.log(`🌊 Пачатак разумнага сартавання FlowSort для плэйліста (ID: ${playlistId})...`);
  
  try {
    // Правяраем, ці існуе сам аб'ект FlowSort
    if (typeof FlowSort === 'undefined' || !FlowSort.sortBalancedWave) {
       Logger.log('❌ Памылка: Аб\'ект FlowSort не знойдзены. Пераканайцеся, што файл FlowSort.gs існуе і не мае памылак.');
       return;
    }

    const tracks = Source.getPlaylistTracks('', playlistId);
    
    if (!tracks || tracks.length < 4) {
      Logger.log('ℹ️ Занадта мала трэкаў для сартавання (трэба мінімум 4). Прапускаем.');
      return;
    }

    let weights = {};
    if (preset === 'atmospheric') {
      // Ідэальна для пост-панка, індзі, колдвейва (трымае рытм, максімальная ўвага на гармонію)
      weights = { tempo: 0.40, harmony: 0.55, energy: 0.05, valence: 0.0 };
    } else if (preset === 'drive') {
      // Для роўнага біта, спорту, дыскатэкі
      weights = { tempo: 0.80, harmony: 0.15, energy: 0.05, valence: 0.0 };
    } else {
      // 'radio' - збалансаваны
      weights = { tempo: 0.50, harmony: 0.30, energy: 0.15, valence: 0.05 };
    }

    const sortedTracks = FlowSort.sortBalancedWave(tracks, { weights: weights });
    
    Playlist.saveWithReplace({
      id: playlistId,
      tracks: sortedTracks
    });
    
    Logger.log('✅ Плэйліст паспяхова адсартаваны ў ідэальную гукавую хвалю!');
  } catch (e) {
    Logger.log(`❌ Памылка падчас сартавання: ${e.toString()}`);
  }
}
