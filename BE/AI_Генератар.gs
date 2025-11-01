/**
 * @OnlyCurrentDoc
 * Універсальны генератар плэйлістоў на аснове AI.
 * Можа ствараць плэйлісты па тэкставай тэме або на аснове існуючага плэйліста-ўзору.
 * Можа як ствараць новыя плэйлісты, так і цалкам абнаўляць існуючыя.
 *
 * Версія: 2.1 (Надзейнае стварэнне, інтэлектуальныя назвы)
 */

// ===============================================================
//                           КАНФІГУРАЦЫЯ ГЕНЕРАТАРА
// ===============================================================

const GENERATOR_CONFIG = {
  // === АСНОЎНЫЯ НАЛАДЫ РЭЖЫМУ ===

  // Рэжым працы:
  // 'TOPIC'    - Стварыць плэйліст на аснове тэкставага апісання (гл. TOPIC_PROMPT).
  // 'PLAYLIST' - Стварыць плэйліст на аснове аналізу іншага плэйліста (гл. SOURCE_PLAYLIST_ID).
  MODE: 'TOPIC', // <<<=== АБЯРЫЦЕ РЭЖЫМ: 'TOPIC' або 'PLAYLIST'

  // Дзеянне на выхадзе:
  // 'CREATE_NEW'      - Стварыць цалкам новы плэйліст.
  // 'UPDATE_EXISTING' - Цалкам перазапісаць існуючы плэйліст (гл. TARGET_PLAYLIST_ID).
  ACTION: 'CREATE_NEW', // <<<=== АБЯРЫЦЕ ДЗЕЯННЕ: 'CREATE_NEW' або 'UPDATE_EXISTING'

  // === НАЛАДЫ ДЛЯ РЭЖЫМУ 'TOPIC' ===

  // Апішыце тэму, настрой, жанры для вашага будучага плэйліста.
  TOPIC_PROMPT: 'Мнагажанравы лёгкі плейліст у доўгую дарогу',
  
  // === НАЛАДЫ ДЛЯ РЭЖЫМУ 'PLAYLIST' ===

  // ID плэйліста-ўзору для аналізу.
  SOURCE_PLAYLIST_ID: 'YOUR_SOURCE_PLAYLIST_ID_HERE',

  // Колькасць выпадковых трэкаў з плэйліста-ўзору для аналізу AI.
  TRACK_SAMPLE_SIZE_FOR_AI: 400,

  // === НАЛАДЫ ДЛЯ ВЫНІКУ ===

  // ID плэйліста для абнаўлення (калі ACTION = 'UPDATE_EXISTING').
  TARGET_PLAYLIST_ID: 'YOUR_TARGET_PLAYLIST_ID_HERE',

  // Назва для новага плэйліста, створанага па тэме
  NEW_PLAYLIST_NAME_FOR_TOPIC: 'AI Плэйліст: {topic}',
  // Назва для новага плэйліста, створанага на аснове іншага
  NEW_PLAYLIST_NAME_FOR_PLAYLIST: 'AI Рэкамендацыі: {source_name}',


  // === АГУЛЬНЫЯ НАЛАДЫ ===
  GEMINI_MODEL: 'gemini-2.5-pro',
  GENERATE_COVER: true, // Ствараць вокладку для плэйліста? (true/false)
  // Колькасць трэкаў, якую трэба запытаць у AI.
  NUMBER_OF_TRACKS_TO_REQUEST: 200
};

// ===============================================================
//                АСНОЎНАЯ ФУНКЦЫЯ ГЕНЕРАТАРА
// ===============================================================

/**
 * Галоўная функцыя для запуску генератара ў абраным рэжыме.
 */
function generateCustomPlaylist() {
  try {
    const config = GENERATOR_CONFIG;
    Logger.log(`Запуск генератара ў рэжыме: ${config.MODE}, Дзеянне: ${config.ACTION}`);
    
    const geminiApiKey = getGeminiApiKey_();
    let promptText = '';
    let sourcePlaylistName = ''; // Для апісанняў і назваў

    // --- КРОК 1: Падрыхтоўка промпту ў залежнасці ад рэжыму ---
    if (config.MODE === 'PLAYLIST') {
      const sourcePlaylistInfo = Playlist.getById(config.SOURCE_PLAYLIST_ID);
      if (!sourcePlaylistInfo) throw new Error(`Не знойдзены плэйліст-узор з ID: ${config.SOURCE_PLAYLIST_ID}`);
      
      sourcePlaylistName = sourcePlaylistInfo.name;
      const sourceTracks = Source.getPlaylistTracks('', config.SOURCE_PLAYLIST_ID);
      if (sourceTracks.length === 0) throw new Error('Плэйліст-узор пусты.');

      const tracksJson = prepareEnrichedSample_(sourceTracks);
      promptText = createPromptFromPlaylist_(sourcePlaylistName, tracksJson);

    } else if (config.MODE === 'TOPIC') {
      promptText = createPromptFromTopic_(config.TOPIC_PROMPT);
    
    } else {
      throw new Error(`Няправільны рэжым працы: ${config.MODE}. Даступныя: 'TOPIC', 'PLAYLIST'.`);
    }

    // --- КРОК 2: Выклік AI і пошук трэкаў ---
    Logger.log('Выклік Gemini API для атрымання рэкамендацый...');
    const aiResponse = callGeminiApi_(geminiApiKey, config.GEMINI_MODEL, promptText);
    if (!aiResponse) throw new Error('Атрыманы пусты адказ ад Gemini API.');

    const tracksToSearch = parseAiResponse_(aiResponse).map(track => normalizeTrackQuery_(track));
    Logger.log(`AI рэкамендаваў ${tracksToSearch.length} трэкаў. Пачынаем пошук на Spotify...`);
    
    const foundTracks = Search.multisearchTracks(tracksToSearch);
    Filter.dedupTracks(foundTracks);
    Logger.log(`Пасля пошуку і ачысткі знойдзена ${foundTracks.length} унікальных трэкаў.`);

    if (foundTracks.length === 0) {
      Logger.log('Не знойдзена ніводнага трэка. Завяршэнне працы.');
      return;
    }
    
    // --- КРОК 3: Захаванне выніку ў залежнасці ад дзеяння ---
    saveOrUpdateCustomPlaylist_(foundTracks, sourcePlaylistName);

    Logger.log('Працэс паспяхова завершаны!');

  } catch (error) {
    Logger.log(`КРЫТЫЧНАЯ ПАМЫЛКА: ${error.toString()}\nСтэк: ${error.stack}`);
  }
}

// ===============================================================
//                ЛОГІКА ЗАХАВАННЯ І АБНАЎЛЕННЯ
// ===============================================================

/**
 * [ВЕРСІЯ 2.1] Стварае новы або абнаўляе існуючы плэйліст знойдзенымі трэкамі і вокладкай.
 * Уключае надзейны механізм атрымання ID новага плэйліста.
 * @param {Array<Object>} tracks - Масіў знойдзеных на Spotify трэкаў.
 * @param {string} [sourcePlaylistName=''] - Назва плэйліста-крыніцы (для шаблонаў).
 */
function saveOrUpdateCustomPlaylist_(tracks, sourcePlaylistName = '') {
    const config = GENERATOR_CONFIG;
    const dateStr = new Date().toLocaleDateString('be-BY');
    let playlistId, playlistName, playlistDescription;

    if (config.ACTION === 'CREATE_NEW') {
        Logger.log('Рэжым дзеяння: Стварэнне новага плэйліста.');

        if (config.MODE === 'PLAYLIST') {
            playlistName = config.NEW_PLAYLIST_NAME_FOR_PLAYLIST.replace('{source_name}', sourcePlaylistName);
            playlistDescription = `Згенеравана ${dateStr} на аснове плэйліста "${sourcePlaylistName}".`;
        } else { // TOPIC mode
            let shortTopic = getTopicSummary_(config.TOPIC_PROMPT);

            if (!shortTopic) {
                Logger.log('Не атрымалася згенераваць AI-назву, выкарыстоўваем стандартнае абразанне.');
                shortTopic = config.TOPIC_PROMPT.length > 50 
                    ? config.TOPIC_PROMPT.substring(0, 47) + '...' 
                    : config.TOPIC_PROMPT;
            }
            
            playlistName = config.NEW_PLAYLIST_NAME_FOR_TOPIC.replace('{topic}', shortTopic);
            playlistDescription = `Згенеравана ${dateStr} па тэме: "${config.TOPIC_PROMPT}".`;
        }
        
        Logger.log('Атрыманне спісу плэйлістоў перад стварэннем...');
        const initialPlaylists = Playlist.getPlaylistArray();
        const initialPlaylistIds = new Set(initialPlaylists.map(p => p.id));

        Playlist.saveWithReplace({
            name: playlistName,
            description: playlistDescription,
            isPublic: false,
            tracks: tracks
        });

        Logger.log('Пошук ID новага плэйліста...');
        Utilities.sleep(3000); 
        const finalPlaylists = Playlist.getPlaylistArray();
        const newPlaylist = finalPlaylists.find(p => !initialPlaylistIds.has(p.id));

        if (newPlaylist) {
            playlistId = newPlaylist.id;
            Logger.log(`✅ Новы плэйліст "${playlistName}" паспяхова створаны з ID: ${playlistId}`);
        } else {
            Logger.log('Не атрымалася знайсці новы плэйліст па розніцы ID. Спрабуем знайсці па назве...');
            const foundByName = Playlist.getByName(playlistName);
            if (foundByName) {
                playlistId = foundByName.id;
                Logger.log(`✅ Аварыйны пошук: плэйліст "${playlistName}" знойдзены па назве з ID: ${playlistId}`);
            } else {
                throw new Error('КРЫТЫЧНА: Не атрымалася вызначыць ID новага плэйліста нават па назве. Магчыма, ён не быў створаны.');
            }
        }

    } else if (config.ACTION === 'UPDATE_EXISTING') {
        Logger.log(`Рэжым дзеяння: Абнаўленне існуючага плэйліста (ID: ${config.TARGET_PLAYLIST_ID}).`);
        if (!config.TARGET_PLAYLIST_ID) throw new Error('Не пазначаны TARGET_PLAYLIST_ID для абнаўлення.');
        
        playlistId = config.TARGET_PLAYLIST_ID;
        const targetPlaylistInfo = Playlist.getById(playlistId);
        playlistName = targetPlaylistInfo.name;

        playlistDescription = config.MODE === 'PLAYLIST' 
            ? `Абноўлена ${dateStr} на аснове "${sourcePlaylistName}". ${tracks.length} трэкаў.`
            : `Абноўлена ${dateStr} па тэме "${config.TOPIC_PROMPT}". ${tracks.length} трэкаў.`;
        
        Playlist.saveWithReplace({
            id: playlistId,
            description: playlistDescription,
            tracks: tracks
        });
        Logger.log(`✅ Плэйліст "${playlistName}" паспяхова абноўлены.`);

    } else {
        throw new Error(`Няправільнае дзеянне: ${config.ACTION}. Даступныя: 'CREATE_NEW', 'UPDATE_EXISTING'.`);
    }

    if (config.GENERATE_COVER && playlistId) {
        Logger.log('Пачатак генерацыі вокладкі...');
        const coverImageBase64 = generatePlaylistCover_(tracks);
        if (coverImageBase64) {
            try {
                SpotifyRequest.putImage(`${API_BASE_URL}/playlists/${playlistId}/images`, coverImageBase64);
                Logger.log('✅ Вокладка паспяхова загружана.');
            } catch (e) {
                Logger.log(`⚠️ Памылка падчас загрузкі вокладкі: ${e.toString()}`);
            }
        } else {
             Logger.log('Не атрымалася згенераваць вокладку, крок прапушчаны.');
        }
    }
}

// ===============================================================
//                ПАДРЫХТОЎКА ДАДЗЕНЫХ І ПРОМПТАЎ
// ===============================================================

function createPromptFromTopic_(topic) {
  return `
[Роля]: Ты — музычны энцыклапедыст і куратар з бездакорным густам.
[Задача]: Ствары плэйліст з ${GENERATOR_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST} трэкаў, які ідэальна адпавядае наступнаму апісанню: "${topic}".
[Правілы]:
- Падбірай як вядомыя, так і менш відавочныя трэкі, якія адпавядаюць тэме.
- Забяспеч разнастайнасць унутры зададзенага стылю.
- Не ўключай песні на рускай мове.
[Фармат вываду]: Вярні вынік ВЫКЛЮЧНА як JSON-масіў радкоў. Кожны радок - "Artist Name - Track Title".
`;
}

function createPromptFromPlaylist_(playlistName, tracksJsonString) {
  return `
[Роля]: Ты — прафесійны музычны куратар, які аналізуе ДНК існуючага плэйліста, каб стварыць яго ідэальнае прадаўжэнне.
[Уваходныя даныя]: Плэйліст пад назвай "${playlistName}" у фармаце JSON:
\`\`\`json
${tracksJsonString}
\`\`\`
[Задача]: Прааналізуй жанры, настрой, эпохі і гучанне трэкаў. На аснове гэтага ствары новы плэйліст з ${GENERATOR_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST} трэкаў, які будзе адчувацца як натуральнае, але нечаканае развіццё арыгінала.
[Правілы]:
- ~70% рэкамендацый павінны дакладна адпавядаць стылю арыгінала.
- ~30% павінны быць "крокам убок" - сумежныя жанры, іншыя эпохі, менш вядомыя выканаўцы.
- НЕ ўключай у адказ трэкі з арыгінальнага плэйліста.
[Фармат вываду]: Вярні вынік ВЫКЛЮЧНА як JSON-масіў радкоў. Кожны радок - "Artist Name - Track Title".
`;
}

function prepareEnrichedSample_(sourceTracks) {
  Logger.log(`Выбіраем ${GENERATOR_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI} трэкаў для аналізу...`);
  const randomSample = Selector.sliceRandom(sourceTracks, GENERATOR_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
  const fullArtistsInfo = getCachedTracks(randomSample, { artist: true }).artists;
  const enrichedSample = randomSample.map(track => {
    if (!track?.name || !track.artists?.[0]?.id || !track.album) return null;
    const artistInfo = fullArtistsInfo[track.artists[0].id] || {};
    return {
      artist: track.artists[0].name,
      track: track.name,
      year: track.album.release_date ? new Date(track.album.release_date).getFullYear() : null,
      genres: artistInfo.genres || [],
      popularity: track.popularity || 0
    };
  }).filter(item => item !== null);
  Logger.log(`Створана "ўзбагачаная" выбарка з ${enrichedSample.length} трэкаў для адпраўкі ў AI.`);
  return JSON.stringify(enrichedSample);
}

function getTopicSummary_(topicPrompt) {
  if (topicPrompt.length <= 20) {
    return topicPrompt;
  }
  Logger.log('Стварэнне кароткай назвы для плэйліста з дапамогай AI...');
  const summaryPrompt = `
[Роля]: Ты — эксперт па стварэнні кароткіх, выразных загалоўкаў.
[Задача]: Прааналізуй наступную тэму для музычнага плэйліста і сцісні яе сутнасць да 2-3 выразных слоў на той жа мове (беларускай).
[Тэма]: "${topicPrompt}"
[Правілы]:
- Адказ павінен быць ВЫКЛЮЧНА кароткай назвай.
- Без двукоссяў, без тлумачэнняў, без дадатковых слоў.
[Прыклад]: Калі тэма "Атмасферны пост-панк і колдвейв для начной паездкі па горадзе ў дождж", добры вынік — "Начны Пост-панк" або "Дажджлівы Колдвейв".
`;
  try {
    const geminiApiKey = getGeminiApiKey_();
    const summary = callGeminiApi_(geminiApiKey, 'gemini-2.5-flash', summaryPrompt);
    if (summary && summary.trim().length > 0) {
      Logger.log(`AI прапанаваў кароткую назву: "${summary.trim()}"`);
      return summary.trim().replace(/"/g, '');
    } else {
      Logger.log('AI вярнуў пусты адказ для назвы.');
      return null;
    }
  } catch (e) {
    Logger.log(`Памылка падчас стварэння кароткай назвы: ${e.toString()}`);
    return null;
  }
}
