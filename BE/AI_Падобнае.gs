/**
 * @OnlyCurrentDoc
 * AI_Падобнае.gs - Генерацыя плэйліста на аснове аналізу "ДНК" іншага плэйліста-крыніцы.
 * Патрабуе наяўнасці файлаў AI_Агульнае.gs для працы.
 */

const CLONE_CONFIG = {
  // ID плэйліста-крыніцы (Што аналізуем)
  SOURCE_PLAYLIST_ID: 'УСТАЎЦЕ_ID_КРЫНІЦЫ',

  // ID мэтавага плэйліста (Куды захоўваем вынік)
  TARGET_PLAYLIST_ID: 'УСТАЎЦЕ_ID_МЭТЫ',

  // Колькасць выпадковых трэкаў-узораў для перадачы AI (да 500 для эканоміі токенаў)
  TRACK_SAMPLE_SIZE_FOR_AI: 400,
  
  // Колькасць трэкаў, якую мы чакаем ад AI на выхадзе
  NUMBER_OF_TRACKS_TO_REQUEST: 150,

  PLAYLIST_NAME_TEMPLATE: 'AI Рэкамендацыі: {source_name}',
  
  // --- НАЛАДЫ САРТАВАННЯ ---
  SMART_SORT_ENABLED: true,
  SMART_SORT_PRESET: 'radio' // 'atmospheric', 'drive', 'radio'
};


/**
 * Галоўная функцыя: генеруе плэйліст-прадаўжэнне на аснове існуючага.
 */
function generatePlaylistFromSourcePlaylist() {
  try {
    Logger.log('🧬 Пачатак працэсу кланавання і пашырэння плэйліста...');
    
    // 1. Атрыманне даных плэйліста-крыніцы (Вяртаем бяспечны натыўны метад Goofy)
    const sourcePlaylistInfo = Playlist.getById(CLONE_CONFIG.SOURCE_PLAYLIST_ID);
    if (!sourcePlaylistInfo || !sourcePlaylistInfo.name) {
        throw new Error(`Немагчыма атрымаць метаданыя плэйліста-крыніцы: ${CLONE_CONFIG.SOURCE_PLAYLIST_ID}`);
    }
    
    const sourcePlaylistName = sourcePlaylistInfo.name;
    const sourceTracks = Source.getPlaylistTracks('', CLONE_CONFIG.SOURCE_PLAYLIST_ID);
    
    if (!sourceTracks || sourceTracks.length === 0) {
      throw new Error('❌ Плэйліст-крыніца пусты. Аналіз ДНК немагчымы.');
    }
    Logger.log(`✅ Знойдзена ${sourceTracks.length} трэкаў у "${sourcePlaylistName}".`);

    // 2. Падрыхтоўка выбаркі і стварэнне промпту (Аптымізацыя токенаў)
    const randomSample = Selector.sliceRandom(sourceTracks, CLONE_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
    const compactSampleList = randomSample.map(t => `${t.artists[0].name} - ${t.name}`);
    const { systemInstruction, userPrompt } = createClonePrompt_(sourcePlaylistName, JSON.stringify(compactSampleList));

    // 3. Зварот да глабальнага AI-рухавіка
    Logger.log('🧠 Адпраўка ДНК плэйліста на аналіз мадэлі...');
    const aiResult = callGeminiTextAPI(userPrompt, { systemInstruction });
    const rawAiTracks = parseAiResponse(aiResult.responseText);
    
    if (!rawAiTracks || rawAiTracks.length === 0) {
      throw new Error('⚠️ AI не вярнуў ніводнага валіднага трэка. Працэс спынены.');
    }
    Logger.log(`🎯 AI прапанаваў ${rawAiTracks.length} рэкамендацый.`);

    // 4. Бронебітны пошук з анты-галюцынацыямі
    const foundSpotifyTracks = executeSmartSearch(rawAiTracks);
    if (foundSpotifyTracks.length === 0) {
      throw new Error('⚠️ Пасля пошуку ў Spotify не знойдзена ніводнага супадзення. Спыненне.');
    }

    // 5. Фільтрацыя і захаванне
    saveRecommendationsToPlaylist_(foundSpotifyTracks, sourceTracks, sourcePlaylistName);
    
    // 6. Вокладка і сартаванне
    generateAndApplyCover(CLONE_CONFIG.TARGET_PLAYLIST_ID, foundSpotifyTracks);
    if (CLONE_CONFIG.SMART_SORT_ENABLED) {
      applySmartSort(CLONE_CONFIG.TARGET_PLAYLIST_ID, CLONE_CONFIG.SMART_SORT_PRESET);
    }

    Logger.log('🎉 Працэс паспяхова завершаны.');

  } catch (error) {
    Logger.log(`❌ КРЫТЫЧНАЯ ПАМЫЛКА: ${error.toString()}\nСтэк: ${error.stack}`);
  }
}

/**
 * Фармуе сістэмны промпт і запыт карыстальніка для мадэлі на аснове ДНК плэйліста.
 */
function createClonePrompt_(playlistName, tracksJsonString) {
  const total = CLONE_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST;
  const groupA = Math.round(total * 0.60); // 60%
  const groupB = Math.round(total * 0.20); // 20%
  const groupC = total - groupA - groupB;  // 20%

  const systemInstruction = `## Функцыя
Сфарміраваць плэйліст-прадаўжэнне дакладна з ${total} рэальных трэкаў каталога Spotify на аснове аналізу жанраў, эпохі, тэмпу і эмацыйнага характару зыходнага плэйліста (Source DNA).

## Стратэгія міксавання (для ${total} трэкаў)
Раўнамерна перамяшай тры катэгорыі па ўсім плэйлісце (не групуй па блоках):
1. **Група A — Пашырэнне (~${groupA} трэкаў):** Дакладнае трапленне ў жанр і настрой зыходнага плэйліста; вядомыя і шануемыя выканаўцы ў гэтым кірунку.
2. **Група B — Паглыбленне (~${groupB} трэкаў):** "Схаваныя жамчужыны" (B-sides, менш вядомыя гурты таго ж стылю або эпохі).
3. **Група C — Развіццё (~${groupC} трэкаў):** Сумежныя жанры і "масткі" — трэкі, якія гукава перагукаюцца з ДНК, але належаць да іншай эпохі ці стылю.

## Крытэрыі якасці і жорсткія абмежаванні
- **Поўная ўнікальнасць:** Поўная адсутнасць любых трэкаў і любых выканаўцаў, якія ўжо прысутнічаюць у Source DNA, а таксама дублікатаў унутры выніку.
- **Толькі рэальныя трэкі Spotify:** Выкарыстоўвай выключна рэальныя рэлізы з дакладнай арфаграфіяй Spotify, без тэгаў 'Live', 'Remastered', 'Radio Edit'.
- **Фармат элементаў:** Кожны элемент масіву строга ў выглядзе "Artist - Track Name".`;

  const userPrompt = `## Зыходны плэйліст
Назва: "${playlistName}"

## Зыходная ДНК (Source DNA)
${tracksJsonString}

На аснове Source DNA плэйліста "${playlistName}" згенерыруй масіў дакладна з ${total} рэальных трэкаў у фармаце "Artist - Track Name" (раўнамерна змяшаўшы ${groupA} Пашырэнне / ${groupB} Паглыбленне / ${groupC} Развіццё), цалкам выключыўшы любыя трэкі і любых выканаўцаў, прысутных у Source DNA.`;

  return { systemInstruction, userPrompt };
}

/**
 * Фільтруе вынік і запісвае яго ў мэтавы плэйліст.
 */
function saveRecommendationsToPlaylist_(recommendedTracks, sourceTracks, sourcePlaylistName) {
  Logger.log('🧹 Фільтрацыя вынікаў ад дублікатаў і існуючых трэкаў...');
  
  let uniqueNewTracks = Selector.sliceCopy(recommendedTracks);
  Filter.dedupTracks(uniqueNewTracks);
  Filter.removeTracks(uniqueNewTracks, sourceTracks);
  
  if (uniqueNewTracks.length === 0) {
      throw new Error('⚠️ Пасля фільтрацыі не засталося ўнікальных трэкаў. Адмена захавання.');
  }
  
  const dateStr = new Date().toLocaleDateString('be-BY');
  const playlistName = CLONE_CONFIG.PLAYLIST_NAME_TEMPLATE.replace('{source_name}', sourcePlaylistName).substring(0, 100);
  const playlistDescription = `Згенеравана ${dateStr}. Аналіз ДНК плэйліста "${sourcePlaylistName}". Агулам трэкаў: ${uniqueNewTracks.length}.`;

  Logger.log(`💾 Захаванне ${uniqueNewTracks.length} трэкаў у мэтавы плэйліст...`);
  
  Playlist.saveWithReplace({
    id: CLONE_CONFIG.TARGET_PLAYLIST_ID,
    tracks: uniqueNewTracks
  });

  // Надзейнае абнаўленне метаданых праз АБСАЛЮТНЫ шлях да Spotify API
  SpotifyRequest.put(`https://api.spotify.com/v1/playlists/${CLONE_CONFIG.TARGET_PLAYLIST_ID}`, {
    name: playlistName,
    description: playlistDescription
  });
}
