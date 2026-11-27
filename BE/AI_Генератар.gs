/**
 * @OnlyCurrentDoc
 * AI_Генератар.gs - Толькі логіка, тэксты промптаў і налады плэйліста.
 */

const GENERATOR_CONFIG = {
  MODE: 'TOPIC', 
  ACTION: 'UPDATE_EXISTING',
  UPDATE_METHOD: 'APPEND', 
  
  TOPIC_PROMPT: 'Складзі ідэальны, на 100% беларускамоўны плэйліст для доўгага аўтамабільнага падарожжа па Беларусі. Настрой і атмасфера: Светлы, бадзёры, натхняльны, з ноткамі рамантыкі дарогі і любові да роднага краю. Гэта музыка, якая ідэальна гучыць, калі за акном праплываюць беларускія лясы, жытнёвыя палі, азёры і ўтульныя вёсачкі. Яна павінна ствараць адчуванне свабоды, лёгкасці і ўнутранай цеплыні',
  
  // Устаўце сюды ID вашага мэтавага плэйліста
  TARGET_PLAYLIST_ID: 'УСТАЎЦЕ_ID_ВАШАГА_МЭТАВАГА_ПЛЭЙЛІСТА_ТУТ', 
  NUMBER_OF_TRACKS_TO_REQUEST: 100,
  MAX_PLAYLIST_SIZE: 500, // <== ЛІМІТ ДЛЯ ГЕНЕРАТАРА (можаце змяніць пад свае патрэбы)

  CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS: 30,
  
  // --- НАЛАДЫ САРТАВАННЯ ---
  SMART_SORT_ENABLED: true,  // Уключыць FlowSort?
  SMART_SORT_PRESET: 'drive' // 'atmospheric', 'drive', 'radio'
};


function generateCustomPlaylist() {
  const lock = LockService.getScriptLock();
  try {
    // Чакаем да 30 секунд. Калі ідзе ачыстка, чакаем яе завяршэння.
    lock.waitLock(30000); 
  } catch (e) {
    Logger.log('⚠️ Працэс заблакіраваны. Іншы скрыпт зараз працуе з гэтым плэйлістом. Паўтарыце пазней.');
    return;
  }

  try {
    const config = GENERATOR_CONFIG;
    Logger.log(`🚀 Запуск генератара. Рэжым: ${config.MODE}, Метад: ${config.UPDATE_METHOD}`);
    
    // --- НОВАЯ ЛОГІКА: Правяраем памер перад генерацыяй ---
    if (config.ACTION === 'UPDATE_EXISTING' && config.UPDATE_METHOD === 'APPEND') {
      const currentTracks = Source.getPlaylistTracks('', config.TARGET_PLAYLIST_ID);
      if (currentTracks.length >= config.MAX_PLAYLIST_SIZE) {
        Logger.log(`🛑 Плэйліст ужо поўны (зараз ${currentTracks.length} трэкаў, ліміт: ${config.MAX_PLAYLIST_SIZE}).`);
        Logger.log('Генерацыя адменены, пакуль вы не праслухаеце частку песень і не спрацуе ачыстка.');
        return;
      }
      Logger.log(`У плэйлісце ёсць вольнае месца (${currentTracks.length} з ${config.MAX_PLAYLIST_SIZE}).`);
    }
    // --------------------------------------------------------

    // 1. Ствараем промпт
    const { systemInstruction, userPrompt } = createPromptFromTopic_(config.TOPIC_PROMPT);

    // 2. Звяртаемся да AI (выкарыстоўваем функцыю з AI_Агульнае.gs)
    Logger.log('🧠 Пачатак генерацыі спісу трэкаў...');
    const aiResult = callGeminiTextAPI(userPrompt, { systemInstruction });
    const rawAiTracks = parseAiResponse(aiResult.responseText);
    
    Logger.log(`AI прапанаваў ${rawAiTracks.length} трэкаў.`);

    // 3. Разумны пошук (выкарыстоўваем функцыю з AI_Агульнае.gs)
    const foundTracks = executeSmartSearch(rawAiTracks);
    Logger.log(`Фінальна гатова да захавання: ${foundTracks.length} унікальных трэкаў.`);

    if (foundTracks.length === 0) return;
    
    // 4. Захаванне і вокладка
    saveOrUpdateCustomPlaylist_(foundTracks);
    generateAndApplyCover(config.TARGET_PLAYLIST_ID, foundTracks);

    // ВЫКЛІК САРТАВАННЯ
    if (config.SMART_SORT_ENABLED) {
      applySmartSort(config.TARGET_PLAYLIST_ID, config.SMART_SORT_PRESET);
    }

    Logger.log('🎉 Працэс генерацыі паспяхова завершаны!');

  } catch (error) {
    Logger.log(`КРЫТЫЧНАЯ ПАМЫЛКА: ${error.toString()}\nСтэк: ${error.stack}`);
  } finally {
    // Здымаем блакіроўку абавязкова!
    lock.releaseLock();
  }
}

/**
 * Захоўвае або абнаўляе мэтавы плэйліст (Абноўленая логіка апісання)
 */
function saveOrUpdateCustomPlaylist_(tracks) {
    const config = GENERATOR_CONFIG;
    const dateStr = new Date().toLocaleDateString('be-BY');
    let playlistId = config.TARGET_PLAYLIST_ID;
    const targetPlaylistInfo = Playlist.getById(playlistId);

    if (config.UPDATE_METHOD === 'APPEND') {
        const existingTracks = Source.getPlaylistTracks('', playlistId);
        const uniqueNewTracks = Selector.sliceCopy(tracks);
        Filter.removeTracks(uniqueNewTracks, existingTracks);

        if (uniqueNewTracks.length > 0) {
            Logger.log(`Даданне ${uniqueNewTracks.length} новых трэкаў...`);
            Playlist.saveWithAppend({ id: playlistId, tracks: uniqueNewTracks });
            
            const desc = targetPlaylistInfo.description || "";
            
            // АЧЫСТКА: Выдаляем усе старыя пазнакі кшталту [+ 25.3.2026: +47]
            // \s* шукае прабелы перад дужкай, \[\+.*?\] знаходзіць любы тэкст паміж [+ і ]
            const cleanDesc = desc.replace(/\s*\[\+.*?\]/g, '').trim();
            
            SpotifyRequest.put(`${API_BASE_URL}/playlists/${playlistId}`, {
                description: (`${cleanDesc} [+ ${dateStr}: +${uniqueNewTracks.length}]`).substring(0, 300)
            });
        } else {
            Logger.log('⚠️ Няма новых трэкаў для дадання.');
        }
    } else {
        Logger.log('Поўная замена трэкаў...');
        Playlist.saveWithReplace({
            id: playlistId,
            description: `Абноўлена ${dateStr} па тэме "${config.TOPIC_PROMPT}".`,
            tracks: tracks
        });
    }
}

function createPromptFromTopic_(topic) {
  const total = GENERATOR_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST;

  const systemInstruction = `## Function
Generate a cohesive thematic playlist of exactly ${total} real tracks available on Spotify, strictly matched to the target topic, mood, and Belarusian linguistic requirements.

## Acoustic Profiling & Curation Criteria
1. **Topic-Driven Acoustic Profiling:** Align every track to the musical parameters implied by the target topic:
   - *Energy & BPM:* Match the required intensity (high-octane drive, steady focus, or ambient relaxation).
   - *Instrumentation:* Choose fitting textures (electronic/synth-heavy, acoustic/organic, heavy guitars, or minimal beats).
   - *Era & Genre:* Select sub-genres of Belarusian music (historical and contemporary) that naturally fit (e.g., for "Night City Drive" use Synthwave/Coldwave/Post-Punk such as Dlina Volny or Molchat Doma; for "Cozy Winter Morning" use Indie Folk/Acoustic such as Naviband or Vuraj).
2. **Atmospheric Consistency:** Maintain unbroken emotional alignment—never insert a track that breaks the target mood for artist popularity.
3. **Deep Curation:** Balance recognized genre-appropriate anthems with high-quality underground gems.
4. **Linguistic Purity:** Restrict selection entirely to tracks with Belarusian lyrics, or purely instrumental tracks fitting the target topic.

## Strict Constraints
- **Absolute Language Firewall:** Zero Russian language—exclude all tracks with Russian lyrics and all artists primarily associated with the Russian music scene.
- **Verified Spotify Catalog Only:** Include only real, verifiable tracks with exact Spotify spelling (no self-transliteration; preserve native Cyrillic/Latin as listed on Spotify). Omit version tags such as 'Live', 'Remastered', or 'Radio Edit'.
- **Zero Duplicates:** Every entry in the ${total}-track list must be unique.
- **Element Format:** Each array item must strictly follow "Artist - Track Name".`;

  const userPrompt = `## Target Topic / Vibe
${topic}

Based on the target topic above, generate an array of exactly ${total} unique, real Spotify tracks formatted as "Artist - Track Name" (Belarusian lyrics or fitting instrumentals only), preserving exact Spotify spelling, clean titles, unbroken mood consistency, and zero Russian language or Russian scene artists.`;

  return { systemInstruction, userPrompt };
}


function cleanUpGenPlaylist() {
  const lock = LockService.getScriptLock();
  try {
    // Чакаем толькі 2 секунды. Калі плэйліст заняты генератарам — прапускаем.
    lock.waitLock(2000); 
  } catch (e) {
    Logger.log('⏳ Тэматычны плэйліст зараз абнаўляецца генератарам. Прапускаем ачыстку (спрацуе ў наступны раз).');
    return;
  }

  try {
    const days = GENERATOR_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS || 30;
    // Выклікаем універсальную функцыю з AI_Агульнае.gs
    cleanPlaylistFromRecentTracks(GENERATOR_CONFIG.TARGET_PLAYLIST_ID, days);
  } finally {
    // Здымаем блакіроўку
    lock.releaseLock();
  }
}


/**
 * Бясплатны (ручны) метад генерацыі.
 * Збірае гісторыю, просіць AI згенераваць спіс і захоўвае яго ў .txt файл на Google Drive.
 */
function generateTextGenToDrive() {
  try {
    const config = GENERATOR_CONFIG;

    // 1. Ствараем промпт
    const { systemInstruction, userPrompt } = createPromptFromTopic_(config.TOPIC_PROMPT);

    // 2. Звяртаемся да AI (выкарыстоўваем функцыю з AI_Агульнае.gs)
    Logger.log('🧠 Пачатак генерацыі спісу трэкаў...');
    const aiResult = callGeminiTextAPI(userPrompt, { systemInstruction });
    const rawAiTracks = parseAiResponse(aiResult.responseText);
     
    if (!rawAiTracks || rawAiTracks.length === 0) {
      Logger.log('⚠️ AI не вярнуў трэкі. Магчыма, памылка парсінгу.');
      return;
    }
    
    Logger.log(`✅ AI прапанаваў ${rawAiTracks.length} трэкаў.`);
    
    // 3. Захоўваем як тэкставы файл у Google Drive (тэчка "Goofy Data")
    const fileName = 'AI_Topic_Mix.txt';
    const textContent = rawAiTracks.join('\n'); // Злучаем масіў радкоў з пераносам радка
    
    Cache.write(fileName, textContent);
    
    Logger.log(`🎉 Гатова! Файл "${fileName}" паспяхова захаваны ў вашым Google Drive (шукайце ў тэчцы "Goofy Data" ці падтэчцы з вашым ID).`);

  } catch (error) {
    Logger.log(`❌ КРЫТЫЧНАЯ ПАМЫЛКА: ${error.toString()}`);
  }
}
