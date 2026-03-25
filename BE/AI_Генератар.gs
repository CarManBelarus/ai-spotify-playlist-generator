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
  NUMBER_OF_TRACKS_TO_REQUEST: 500,
  MAX_PLAYLIST_SIZE: 500, // <== ЛІМІТ ДЛЯ ГЕНЕРАТАРА (можаце змяніць пад свае патрэбы)

  CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS: 30,
  
  // --- НАЛАДЫ САРТАВАННЯ ---
  SMART_SORT_ENABLED: true,  // Уключыць FlowSort?
  SMART_SORT_PRESET: 'drive' // 'atmospheric', 'drive', 'radio'
};

function generateCustomPlaylist() {
  try {
    const config = GENERATOR_CONFIG;
    Logger.log(`🚀 Запуск генератара. Рэжым: ${config.MODE}, Метад: ${config.UPDATE_METHOD}`);
    
    // --- ЛОГІКА: Правяраем памер перад генерацыяй ---
    if (config.ACTION === 'UPDATE_EXISTING' && config.UPDATE_METHOD === 'APPEND') {
      const currentTracks = Source.getPlaylistTracks('', config.TARGET_PLAYLIST_ID);
      if (currentTracks.length >= config.MAX_PLAYLIST_SIZE) {
        Logger.log(`🛑 Плэйліст ужо поўны (зараз ${currentTracks.length} трэкаў, ліміт: ${config.MAX_PLAYLIST_SIZE}).`);
        Logger.log('Генерацыя адменена, пакуль вы не праслухаеце частку песень і не спрацуе ачыстка.');
        return;
      }
      Logger.log(`У плэйлісце ёсць вольнае месца (${currentTracks.length} з ${config.MAX_PLAYLIST_SIZE}).`);
    }
    // --------------------------------------------------------

    // 1. Ствараем промпт
    let promptText = createPromptFromTopic_(config.TOPIC_PROMPT);

    // 2. Звяртаемся да AI (выкарыстоўваем функцыю з AI_Агульнае.gs)
    Logger.log('🧠 Пачатак генерацыі спісу трэкаў...');
    const aiResult = callGeminiTextAPI(promptText);
    const rawAiTracks = parseAiResponse(aiResult.responseText);
    
    Logger.log(`AI прапанаваў ${rawAiTracks.length} трэкаў.`);

    // 3. Разумны пошук (выкарыстоўваем функцыю з AI_Агульнае.gs)
    const foundTracks = executeSmartSearch(rawAiTracks);
    Logger.log(`Фінальна гатова да захавання: ${foundTracks.length} унікальных трэкаў.`);

    if (foundTracks.length === 0) return;
    
    // 4. Захаванне і вокладка
    saveOrUpdateCustomPlaylist_(foundTracks);
    generateAndApplyCover(config.TARGET_PLAYLIST_ID, foundTracks); 

    // 5. ВЫКЛІК САРТАВАННЯ (заўсёды ў канцы)
    if (config.SMART_SORT_ENABLED) {
      applySmartSort(config.TARGET_PLAYLIST_ID, config.SMART_SORT_PRESET);
    }

    Logger.log('🎉 Працэс генерацыі паспяхова завершаны!');

  } catch (error) {
    Logger.log(`КРЫТЫЧНАЯ ПАМЫЛКА: ${error.toString()}\nСтэк: ${error.stack}`);
  }
}

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
            SpotifyRequest.put(`${API_BASE_URL}/playlists/${playlistId}`, {
                description: (desc + ` [+ ${dateStr}: +${uniqueNewTracks.length}]`).substring(0, 300)
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
  // Сістэмны промпт застаецца на англійскай мове для максімальнай дакладнасці і разумення кантэксту LLM-мадэллю
  return `
<system_instruction>
    <role>
        You are an Elite Contextual Audio Architect and the foremost expert in the Belarusian music scene (historical and contemporary). Your expertise lies in psychographic playlist sequencing — translating abstract moods, activities, or themes into highly cohesive, emotionally resonant acoustic experiences.
    </role>

    <objective>
        Synthesize a highly specific, strictly curated playlist of EXACTLY ${GENERATOR_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST} tracks. The track selection must be absolutely subjugated to the user's requested theme/topic, acting as a flawless soundtrack for that exact context, while maintaining absolute adherence to linguistic constraints.
    </objective>

    <context_awareness>
        - **Target Topic / Vibe:** "${topic}"
        - Treat this topic not as a mere suggestion, but as an absolute acoustic law. Every single track must mathematically and emotionally align with the semantics of this topic.
    </context_awareness>

    <behavioral_guidelines>
        1. **Topic-Driven Acoustic Profiling (CRITICAL):** Before selecting tracks, dynamically map the requested "${topic}" to specific musical parameters:
           - *Energy & BPM:* Does the topic demand high-octane drive, steady focus, or ambient relaxation?
           - *Instrumentation:* Should it be electronic/synth-heavy, acoustic/organic, heavy guitars, or minimal beats?
           - *Era & Genre:* Select the sub-genres of Belarusian music that naturally fit (e.g., if topic is "Night City Drive," strictly use Synthwave/Coldwave/Post-Punk like Dlina Volny or Molchat Doma. If "Cozy Winter Morning," strictly use Indie Folk/Acoustic like Naviband or Vuraj).
        2. **Atmospheric Consistency:** Do not break the mood. If the topic is "Melancholy," do not insert an upbeat pop song just because the artist is famous. Every track must serve the primary emotional target.
        3. **Deep Curation:** Balance recognized genre-appropriate anthems with high-quality underground gems to create a sophisticated texture.
        4. **Linguistic Purity:** You are restricted entirely to tracks where the lyrics are in the Belarusian language, or purely instrumental tracks that perfectly fit the "${topic}".
    </behavioral_guidelines>

    <strict_constraints>
        * **ABSOLUTE LANGUAGE FIREWALL:** ZERO Russian language. DO NOT include any track with Russian lyrics. DO NOT include artists primarily associated with the Russian scene. This is a critical failure condition.
        * **EXACT COUNT:** You must return exactly ${GENERATOR_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST} tracks. No more, no less.
        * **NO MARKDOWN:** Do NOT wrap the output in \`\`\`json or any other markdown formatting.
        * **RAW OUTPUT:** Output ONLY a valid JSON array of strings. No conversational text, no explanations, no titles, no thoughts.
        * **SCHEMA:**["Artist - Track Name", "Artist - Track Name"]
    </strict_constraints>

    <interaction_style>
        Completely silent executor. You speak only in raw, unformatted JSON arrays.
    </interaction_style>
</system_instruction>
`;
}

function cleanUpGenPlaylist() {
  const days = GENERATOR_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS || 30;
  // Выклікаем універсальную функцыю з AI_Агульнае.gs
  cleanPlaylistFromRecentTracks(GENERATOR_CONFIG.TARGET_PLAYLIST_ID, days);
}

/**
 * Бясплатны (ручны) метад генерацыі.
 * Збірае гісторыю, просіць AI згенераваць спіс і захоўвае яго ў .txt файл на Google Drive.
 */
function generateTextGenToDrive() {
  try {
    const config = GENERATOR_CONFIG;

    // 1. Ствараем промпт
    let promptText = createPromptFromTopic_(config.TOPIC_PROMPT);

    // 2. Звяртаемся да AI
    Logger.log('🧠 Пачатак генерацыі спісу трэкаў...');
    const aiResult = callGeminiTextAPI(promptText);
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
