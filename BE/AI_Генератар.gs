/**
 * @OnlyCurrentDoc
 * Універсальны генератар плэйлістоў на аснове AI.
 * ВЕРСІЯ: "Golden Release" (Multi-Model Gemini + Бяспечныя плэйсхолдары)
 * 
 * Гэты скрыпт дазваляе ствараць новыя плэйлісты "з нуля" па тэме 
 * або на аснове іншага плэйліста-ўзору.
 */

// ===============================================================
//                           КАНФІГУРАЦЫЯ
// ===============================================================

const GENERATOR_CONFIG = {
  // === АСНОЎНЫЯ НАЛАДЫ РЭЖЫМУ ===

  // Рэжым працы:
  // 'TOPIC'    - Стварыць плэйліст па апісанні (TOPIC_PROMPT).
  // 'PLAYLIST' - Стварыць плэйліст на аснове іншага (SOURCE_PLAYLIST_ID).
  MODE: 'TOPIC', 

  // Дзеянне:
  // 'CREATE_NEW'      - Стварыць новы плэйліст.
  // 'UPDATE_EXISTING' - Перазапісаць існуючы (TARGET_PLAYLIST_ID).
  ACTION: 'CREATE_NEW', 

  // === НАЛАДЫ ДЛЯ РЭЖЫМУ 'TOPIC' ===
  TOPIC_PROMPT: 'Мнагажанравы цалкам беларускамоўны лёгкі плейліст у доўгую дарогу',
  
  // === НАЛАДЫ ДЛЯ РЭЖЫМУ 'PLAYLIST' ===
  SOURCE_PLAYLIST_ID: 'INSERT_SOURCE_PLAYLIST_ID_HERE', // Узор для аналізу
  TRACK_SAMPLE_SIZE_FOR_AI: 400, // Колькасць трэкаў для аналізу

  // === НАЛАДЫ ДЛЯ ВЫНІКУ ===
  // ID плэйліста, які будзе перазапісаны (толькі для UPDATE_EXISTING)
  TARGET_PLAYLIST_ID: 'INSERT_TARGET_PLAYLIST_ID_HERE',

  // Шаблоны назваў для новых плэйлістоў
  NEW_PLAYLIST_NAME_FOR_TOPIC: 'AI Плэйліст: {topic}',
  NEW_PLAYLIST_NAME_FOR_PLAYLIST: 'AI Рэкамендацыі: {source_name}',

  // === АГУЛЬНЫЯ НАЛАДЫ AI (MULTI-MODEL) ===
  // Спіс мадэляў па прыярытэце (Fallback System)
  GEMINI_MODELS_PRIORITY: [
    'gemini-2.5-pro',          // 1. Разумная
    'gemini-flash-latest',     // 2. Хуткая
    'gemini-flash-lite-latest' // 3. Лёгкая
  ],

  GENERATE_COVER: true, // Генераваць вокладку?
  NUMBER_OF_TRACKS_TO_REQUEST: 200 // Колькасць трэкаў у выніку
};

// ===============================================================
//                АСНОЎНАЯ ФУНКЦЫЯ ГЕНЕРАТАРА
// ===============================================================

function generateCustomPlaylist() {
  try {
    const config = GENERATOR_CONFIG;
    Logger.log(`🚀 Запуск генератара ў рэжыме: ${config.MODE}, Дзеянне: ${config.ACTION}`);
    
    const geminiApiKey = getGeminiApiKey_();
    let promptText = '';
    let sourcePlaylistName = ''; 

    // 1. Падрыхтоўка промпту
    if (config.MODE === 'PLAYLIST') {
      const sourcePlaylistInfo = Playlist.getById(config.SOURCE_PLAYLIST_ID);
      if (!sourcePlaylistInfo) throw new Error(`Не знойдзены плэйліст-узор.`);
      
      sourcePlaylistName = sourcePlaylistInfo.name;
      const sourceTracks = Source.getPlaylistTracks('', config.SOURCE_PLAYLIST_ID);
      if (sourceTracks.length === 0) throw new Error('Плэйліст-узор пусты.');

      const tracksJson = prepareEnrichedSample_(sourceTracks);
      promptText = createPromptFromPlaylist_(sourcePlaylistName, tracksJson);

    } else if (config.MODE === 'TOPIC') {
      promptText = createPromptFromTopic_(config.TOPIC_PROMPT);
    } else {
      throw new Error(`Няправільны рэжым: ${config.MODE}`);
    }

    // 2. Выклік AI з цыклам Fallback
    let aiResponse = null;
    let usedModel = '';

    Logger.log('🧠 Генерацыя спісу трэкаў...');

    for (const modelName of config.GEMINI_MODELS_PRIORITY) {
      Logger.log(`🔄 Спроба: "${modelName}"...`);
      aiResponse = callGeminiApi_(geminiApiKey, modelName, promptText);
      
      if (aiResponse) {
        Logger.log(`✅ Мадэль "${modelName}" адказала.`);
        usedModel = modelName;
        break; 
      } else {
        Logger.log(`⚠️ Мадэль "${modelName}" не адказала. Пераход да наступнай...`);
        Utilities.sleep(1000);
      }
    }

    if (!aiResponse) throw new Error('❌ Усе мадэлі Gemini недаступныя.');

    // 3. Пошук трэкаў
    const tracksToSearch = parseAiResponse_(aiResponse).map(track => normalizeTrackQuery_(track));
    Logger.log(`AI (${usedModel}) прапанаваў ${tracksToSearch.length} трэкаў. Пачынаем пошук...`);
    
    const foundTracks = Search.multisearchTracks(tracksToSearch);
    Filter.dedupTracks(foundTracks);
    Logger.log(`Знойдзена ${foundTracks.length} унікальных трэкаў.`);

    if (foundTracks.length === 0) {
        Logger.log('Трэкі не знойдзены.');
        return;
    }
    
    // 4. Захаванне
    saveOrUpdateCustomPlaylist_(foundTracks, sourcePlaylistName);
    Logger.log('🎉 Гатова!');

  } catch (error) {
    Logger.log(`КРЫТЫЧНАЯ ПАМЫЛКА: ${error.toString()}`);
  }
}

// ===============================================================
//                ЛОГІКА ЗАХАВАННЯ І АБНАЎЛЕННЯ
// ===============================================================

function saveOrUpdateCustomPlaylist_(tracks, sourcePlaylistName = '') {
    const config = GENERATOR_CONFIG;
    const dateStr = new Date().toLocaleDateString('be-BY');
    let playlistId, playlistName, playlistDescription;

    if (config.ACTION === 'CREATE_NEW') {
        Logger.log('Стварэнне новага плэйліста...');

        if (config.MODE === 'PLAYLIST') {
            playlistName = config.NEW_PLAYLIST_NAME_FOR_PLAYLIST.replace('{source_name}', sourcePlaylistName);
            playlistDescription = `Згенеравана ${dateStr} на аснове "${sourcePlaylistName}".`;
        } else { 
            // Генерацыя разумнай кароткай назвы
            let shortTopic = getTopicSummary_(config.TOPIC_PROMPT);
            if (!shortTopic) {
                shortTopic = config.TOPIC_PROMPT.length > 50 
                    ? config.TOPIC_PROMPT.substring(0, 47) + '...' 
                    : config.TOPIC_PROMPT;
            }
            playlistName = config.NEW_PLAYLIST_NAME_FOR_TOPIC.replace('{topic}', shortTopic);
            playlistDescription = `Згенеравана ${dateStr} па тэме: "${config.TOPIC_PROMPT}".`;
        }
        
        // Лагічны блок стварэння і пошуку ID
        const initialPlaylists = Playlist.getPlaylistArray();
        const initialPlaylistIds = new Set(initialPlaylists.map(p => p.id));

        Playlist.saveWithReplace({
            name: playlistName,
            description: playlistDescription,
            isPublic: false,
            tracks: tracks
        });

        Utilities.sleep(3000); // Чакаем сінхранізацыі
        const finalPlaylists = Playlist.getPlaylistArray();
        const newPlaylist = finalPlaylists.find(p => !initialPlaylistIds.has(p.id));

        if (newPlaylist) {
            playlistId = newPlaylist.id;
            Logger.log(`✅ Створаны плэйліст ID: ${playlistId}`);
        } else {
            // Аварыйны пошук па назве
            const foundByName = Playlist.getByName(playlistName);
            if (foundByName) {
                playlistId = foundByName.id;
                Logger.log(`✅ Плэйліст знойдзены па назве: ${playlistId}`);
            } else {
                Logger.log('⚠️ Не ўдалося вызначыць ID новага плэйліста. Вокладка не будзе ўсталявана.');
            }
        }

    } else if (config.ACTION === 'UPDATE_EXISTING') {
        Logger.log(`Абнаўленне плэйліста ID: ${config.TARGET_PLAYLIST_ID}`);
        if (!config.TARGET_PLAYLIST_ID || config.TARGET_PLAYLIST_ID.includes('INSERT')) {
             throw new Error('ID для абнаўлення не зададзены.');
        }
        
        playlistId = config.TARGET_PLAYLIST_ID;
        const targetInfo = Playlist.getById(playlistId);
        playlistName = targetInfo ? targetInfo.name : 'Плэйліст';

        playlistDescription = config.MODE === 'PLAYLIST' 
            ? `Абноўлена ${dateStr} на аснове "${sourcePlaylistName}".`
            : `Абноўлена ${dateStr} па тэме "${config.TOPIC_PROMPT}".`;
        
        Playlist.saveWithReplace({
            id: playlistId,
            description: playlistDescription,
            tracks: tracks
        });
        Logger.log(`✅ Плэйліст абноўлены.`);
    }

    // Генерацыя вокладкі (выкарыстоўвае функцыі з галоўнага файла)
    if (config.GENERATE_COVER && playlistId && typeof generatePlaylistCover_ === 'function') {
        Logger.log('Генерацыя вокладкі...');
        // Часова падмяняем ID у глабальным канфігу, каб generatePlaylistCover_ ведала адкуль браць кантэкст,
        // АБО перадаем трэкі напрамую, калі функцыя гэта падтрымлівае.
        // У нашай рэалізацыі лепш выкарыстоўваць ужо знойдзеныя трэкі для генерацыі промпта.
        const coverImageBase64 = generateCoverFromTracksList_(tracks); 
        
        if (coverImageBase64) {
            try {
                SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${playlistId}/images`, coverImageBase64);
                Logger.log('✅ Вокладка загружана.');
            } catch (e) { Logger.log(`⚠️ Памылка загрузкі вокладкі: ${e}`); }
        }
    }
}

// ===============================================================
//                ПАДРЫХТОЎКА ДАДЗЕНЫХ І ПРОМПТАЎ
// ===============================================================

function createPromptFromTopic_(topic) {
  return `
[Роля]: Music Curator.
[Задача]: Ствары плэйліст (${GENERATOR_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST} трэкаў) па тэме: "${topic}".
[Правілы]:
- Разнастайны мікс (хіты + андэграўнд).
- Выключыць: Рускамоўныя песні (Russian language).
- Прыярытэт: Якасць і атмасфера.
[Фармат]: ВЫКЛЮЧНА JSON-масіў радкоў "Artist - Track".
`;
}

function createPromptFromPlaylist_(playlistName, tracksJsonString) {
  return `
[Роля]: AI Music Curator.
[Уваход]: Плэйліст "${playlistName}" (JSON).
\`\`\`${tracksJsonString}\`\`\`
[Задача]: Ствары працяг/сіквел (${GENERATOR_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST} трэкаў).
[Правілы]:
- 70% падобны стыль, 30% эксперыменты.
- Выключыць: Рускамоўныя песні.
- Выключыць: Дублікаты з уваходу.
[Фармат]: ВЫКЛЮЧНА JSON-масіў радкоў "Artist - Track".
`;
}

function prepareEnrichedSample_(sourceTracks) {
  Logger.log(`Выбарка ${GENERATOR_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI} трэкаў...`);
  const randomSample = Selector.sliceRandom(sourceTracks, GENERATOR_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
  // Спрошчаны фармат для эканоміі токенаў
  const enrichedSample = randomSample.map(track => {
    if (!track?.name || !track.artists?.[0]?.name) return null;
    return `${track.artists[0].name} - ${track.name}`;
  }).filter(item => item !== null);
  return JSON.stringify(enrichedSample);
}

function getTopicSummary_(topicPrompt) {
  if (topicPrompt.length <= 25) return topicPrompt;

  Logger.log('Стварэнне кароткай назвы...');
  const summaryPrompt = `
Shorten this playlist title to 2-3 words (Belarusian language). 
Topic: "${topicPrompt}". 
Output ONLY the title. No quotes.
`;
  
  const apiKey = getGeminiApiKey_();
  for (const model of GENERATOR_CONFIG.GEMINI_MODELS_PRIORITY) {
    try {
       const summary = callGeminiApi_(apiKey, model, summaryPrompt);
       if (summary && summary.trim().length > 0) {
         return summary.trim().replace(/["«»]/g, '');
       }
    } catch (e) {}
  }
  return null;
}

/**
 * Лакальная версія генератара вокладкі, якая прымае спіс трэкаў наўпрост.
 * Гэта дазваляе не залежаць ад глабальнага ID плэйліста.
 */
function generateCoverFromTracksList_(tracks) {
    if (typeof createImagePromptFromTracks_ !== 'function' || typeof callHuggingFaceApiWithModel_ !== 'function') {
        Logger.log('Неабходныя функцыі з AI_Плэйлісты.gs недаступныя.');
        return null;
    }

    const imagePrompt = createImagePromptFromTracks_(tracks);
    if (!imagePrompt) return null;

    // Выкарыстоўваем "Залаты спіс" з глабальнага канфіга AI_Плэйлісты.gs або лакальны дэфолт
    const models = (typeof AI_CONFIG !== 'undefined' && AI_CONFIG.IMAGE_GENERATION) 
        ? [
            AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.FLUX_DEV,
            AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.FLUX_SCHNELL,
            AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.SD3_MEDIUM,
            AI_CONFIG.IMAGE_GENERATION.AVAILABLE_MODELS.SDXL_BASE
          ]
        : ['black-forest-labs/FLUX.1-schnell', 'stabilityai/stable-diffusion-xl-base-1.0'];

    for (const modelId of models) {
        if (!modelId) continue;
        Logger.log(`🎨 Генерацыя вокладкі: "${modelId}"...`);
        const imageBase64 = callHuggingFaceApiWithModel_(imagePrompt, modelId);
        if (imageBase64) return imageBase64;
    }
    return null;
}
