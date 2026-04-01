/**
 * @OnlyCurrentDoc
 * AI_Плэйлісты.gs - Аналіз захаваных трэкаў і генерацыя штодзённых міксаў.
 */

const AI_CONFIG = {
  // Устаўце сюды ID вашага плэйліста Spotify для штодзённых абнаўленняў
  SPOTIFY_PLAYLIST_ID: 'УСТАЎЦЕ_ID_ВАШАГА_ПЛЭЙЛІСТА_ТУТ', 
  
  TRACK_SAMPLE_SIZE_FOR_AI: 500,
  NUMBER_OF_TRACKS_TO_REQUEST: 100, 
  MAX_PLAYLIST_SIZE: 500, 
  PLAYLIST_NAME_TEMPLATE: 'AI Плэйліст ад {date}',
  CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS: 60,
  
  // --- НАЛАДЫ САРТАВАННЯ ---
  SMART_SORT_ENABLED: true,
  SMART_SORT_PRESET: 'atmospheric' // 'atmospheric', 'drive', 'radio'
};

function generateAndCreateSpotifyPlaylist() {
  const lock = LockService.getScriptLock();
  try {
    // Чакаем да 30 секунд. Калі ў гэты момант ідзе ачыстка (якая займае 5-10 сек),
    // скрыпт пачакае і пачне генерацыю. Калі блакіроўка вісіць даўжэй - адмена.
    lock.waitLock(30000); 
  } catch (e) {
    Logger.log('⚠️ Працэс заблакіраваны. Іншы скрыпт зараз працуе з плэйлістом. Паўтарыце пазней.');
    return;
  }

  try {
    Logger.log('Пачатак працэсу стварэння AI плэйліста...');

    // --- НОВАЯ ЛОГІКА: Правяраем памер да пачатку генерацыі ---
    const currentTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
    if (currentTracks.length >= AI_CONFIG.MAX_PLAYLIST_SIZE) {
      Logger.log(`🛑 Плэйліст ужо поўны (зараз ${currentTracks.length} трэкаў, ліміт: ${AI_CONFIG.MAX_PLAYLIST_SIZE}).`);
      Logger.log('Зварот да AI і пошук новых трэкаў адменены, пакуль не з\'явіцца вольнае месца.');
      return; 
    }
    Logger.log(`У плэйлісце ёсць вольнае месца (${currentTracks.length} з ${AI_CONFIG.MAX_PLAYLIST_SIZE}). Працягваем...`);
    // ------------------------------------------------------------


    // 1. Бярэм трэкі
    const allTracks = Cache.read('SavedTracks.json');
    const randomTracks = Selector.sliceRandom(allTracks, AI_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
    const promptText = createTrackRecommendationPrompt_(JSON.stringify(randomTracks));

    // 2. Выклік AI з main.gs
    const aiResult = callGeminiTextAPI(promptText);
    const rawAiTracks = parseAiResponse(aiResult.responseText);
    
    if (rawAiTracks.length === 0) return;

    // 3. Бронебітны пошук з main.gs
    const foundSpotifyTracks = executeSmartSearch(rawAiTracks);
    if (foundSpotifyTracks.length === 0) return;

    // 4. Захаванне
    updatePlaylistIncrementally_(foundSpotifyTracks);

    Logger.log('Працэс паспяхова завершаны.');

  } catch (error) {
    Logger.log(`КРЫТЫЧНАЯ ПАМЫЛКА: ${error.toString()}`);
  } finally {
    // АБАВЯЗКОВА: Здымаем блакіроўку ў канцы, нават калі адбылася памылка
    lock.releaseLock();
  }
}

function updatePlaylistIncrementally_(foundSpotifyTracks) {
  const existingTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  let newUniqueTracks = Selector.sliceCopy(foundSpotifyTracks);
  Filter.removeTracks(newUniqueTracks, existingTracks);

  if (newUniqueTracks.length > 0) {
    Logger.log(`Даданне ${newUniqueTracks.length} новых трэкаў часткамі...`);
    for (let i = 0; i < newUniqueTracks.length; i += 100) {
      Playlist.saveWithAppend({
        id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
        tracks: newUniqueTracks.slice(i, i + 100),
        position: 'begin' 
      });
      Utilities.sleep(1000);
    }
  }

  // Абнаўленне назвы і выклік генератара вокладкі з main.gs
  const finalTotal = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID).length;
  const dateStr = new Date().toLocaleDateString('be-BY');
  
  SpotifyRequest.put(`${API_BASE_URL}/playlists/${AI_CONFIG.SPOTIFY_PLAYLIST_ID}`, {
      name: AI_CONFIG.PLAYLIST_NAME_TEMPLATE.replace('{date}', dateStr),
      description: `Апошняе абнаўленне: ${dateStr}. Агулам: ${finalTotal} трэкаў.`
  });

  generateAndApplyCover(AI_CONFIG.SPOTIFY_PLAYLIST_ID, foundSpotifyTracks);
  
  // Абразанне калі перавышае ліміт
  // const currentTracks = Source.getPlaylistTracks('', AI_CONFIG.SPOTIFY_PLAYLIST_ID);
  // if (currentTracks.length > AI_CONFIG.MAX_PLAYLIST_SIZE) {
  //     Playlist.saveWithReplace({
  //         id: AI_CONFIG.SPOTIFY_PLAYLIST_ID,
  //         tracks: currentTracks.slice(0, AI_CONFIG.MAX_PLAYLIST_SIZE)
  //     });
  // }

    // ВЫКЛІК САРТАВАННЯ (заўсёды ў самым канцы!)
  if (AI_CONFIG.SMART_SORT_ENABLED) {
     applySmartSort(AI_CONFIG.SPOTIFY_PLAYLIST_ID, AI_CONFIG.SMART_SORT_PRESET);
  }
}

function createTrackRecommendationPrompt_(tracksJsonString) {
  const today = new Date();
  const formattedDate = today.toLocaleDateString('be-BY', { year: 'numeric', month: 'long', day: 'numeric' });

 // Дынамічны падлік трэкаў на аснове галоўнага параметра
  const total = AI_CONFIG.NUMBER_OF_TRACKS_TO_REQUEST;
  const coreCount = Math.round(total * 0.55);
  const pivotCount = Math.round(total * 0.25);
  const belarusCount = Math.round(total * 0.15);
  const classicCount = total - coreCount - pivotCount - belarusCount;

return `
<system_instruction>
    <role>
        Ты — элітарны Музычны Куратар і Аналітык Даных Spotify. Твая экспертыза аб'ядноўвае глыбокія веды сусветнай і лакальнай (беларускай) музычнай гісторыі з алгарытмічным разуменнем "ДНК густу" карыстальніка. Ты ствараеш не проста спісы песень, а аўтарскія музычныя падарожжы з бездакорнай логікай развіцця.
    </role>

    <objective>
        Прааналізаваць гісторыю праслухоўвання карыстальніка, вызначыць бягучы каляндарны/сезонны кантэкст і згенераваць ідэальна збалансаваны плэйліст дакладна з ${total} трэкаў у фармаце строгага JSON-масіву.
    </objective>

    <context_awareness>
        - **Бягучая дата:** ${formattedDate}.
        - **Сезоннасць і Святы:** Аўтаматычна вызнач бягучы сезон і набліжэнне святаў (Каляды, Купалле, Дзяды і г.д.). Інтэгруй адпаведны святочны або сезонны настрой у частку трэкаў (напрыклад: змрочны фолк на Дзяды, цёплы соўл/джаз узімку), але захоўвай агульную адпаведнасць ДНК густу.
        - **База густу (ДНК):** Наступны JSON змяшчае гісторыю праслухоўвання карыстальніка. Выкарыстоўвай гэта як адзіны компас для вызначэння жанраў, эпох і тэмпераменту.
          [Input DNA]: ${tracksJsonString}
    </context_awareness>

    <behavioral_guidelines>
        Падчас генерацыі плэйліста выкарыстоўвай наступную стратэгію міксавання (прапорцыі павінны быць выкананы максімальна дакладна для ${total} трэкаў):

        1. **Core Matches (~${coreCount} трэкаў трэкаў): Зона глыбокага камфорту.**
           - Шукай малавядомыя песні (Deep Cuts, B-sides) любімых выканаўцаў карыстальніка. Не дадавай іх галоўныя хіты.
           - Знаходзь новых, падобных па гучанні выканаўцаў, якіх карыстальнік яшчэ не ведае.
        
        2. **Pivots (~${pivotCount} трэкаў): Смелы крок убок.**
           - Пашырай гарызонты праз сумежныя жанры або іншыя эпохі (напрыклад, калі база — індзі-рок, прапануй French Coldwave або Neo-Psychedelia).
           - Тут выкарыстоўвай прынцып "Best Of": давай толькі сусветна прызнаныя эталоны новага жанру, каб карыстальнік мог адразу яго зразумець.
        
        3. **Belarus Spotlight (~${belarusCount} трэкаў): Лакальны кантэкст.**
           - Беларуская музыка (сучасная або класіка), якая ІДЭАЛЬНА пасуе да асноўнага вайбу (DNA).
           - Напрыклад: да пост-панку — Nürnberg / Molchat Doma / Dlina Volny; да року — Мроя / Akute; да фолку — Vuraj / Relikt. Гэта не павінна выглядаць як выпадковая ўстаўка.
        
        4. **Genre Classics ((~${classicCount} трэкаў): Жанравыя шлягеры.**
           - Магутныя "якары" плэйліста. Абсалютныя гімны жанраў, якія дамінуюць у ДНК карыстальніка (напр., "Love Will Tear Us Apart" для пост-панку).
    </behavioral_guidelines>

    <strict_constraints>
        * **КРЫТЫЧНАЯ ЗАБАРОНА (NO RUSSIAN):** НІКОЛІ не ўключай у спіс выканаўцаў з Расіі. НІКОЛІ не ўключай песні на рускай мове ад расійскіх артыстаў. Гэта абсалютны фільтр.
        * **БЕЗ ПАЎТОРАЎ:** Ніводзін трэк з [Input DNA] не павінен з'явіцца ў фінальным плэйлісце.
        * **АЧЫСТКА НАЗВАЎ:** Не выкарыстоўвай тэгі 'Live', 'Remastered', 'Radio Edit' у назвах.
        * **АРФАГРАФІЯ SPOTIFY:** Лакальныя назвы гуртоў павінны быць напісаны ТАК, ЯК У SPOTIFY. Не рабі ўласную транслітарацыю. 
          - Калі ў Spotify кірыліца ("Мроя", "Палац") -> пішы кірыліцай.
          - Калі ў Spotify лацінка ("Akute", "Nürnberg") -> пішы лацінкай.
        * **Агульны памер:** Фінальны плэйліст павінен складацца дакладна з ${total} трэкаў.
    </strict_constraints>

    <output_format>
        ВЫВОДЗІЦЬ ТОЛЬКІ ВАЛІДНЫ JSON. 
        Не дадавай ніякіх уводных слоў, тлумачэнняў або прывітанняў. 
        Фармат павінен быць строга масівам радкоў: ["Artist - Track Name"].
        
        Прыклад чаканага вываду:[
          "Depeche Mode - Enjoy the Silence",
          "Мроя - Я рок-музыкант",
          "Mariya Takeuchi - Plastic Love",
          "Nürnberg - Biessenhofen"
        ]
    </output_format>
</system_instruction>
`;
}



function cleanUpPlaylist() {
  const lock = LockService.getScriptLock();
  try {
    // Калі ідзе генерацыя (займае 3-5 хвілін), ачыстка не павінна чакаць.
    // Яна чакае толькі 2 секунды, і калі плэйліст заняты — проста прапускае гэты запуск.
    lock.waitLock(2000); 
  } catch (e) {
    Logger.log('⏳ Плэйліст зараз абнаўляецца генератарам. Прапускаем ачыстку (яна аўтаматычна спрацуе па наступным трыгеры).');
    return;
  }

  try {
    const days = AI_CONFIG.CLEANUP_LISTENED_TRACKS_OLDER_THAN_DAYS || 60;
    // Выклікаем універсальную функцыю з AI_Агульнае.gs
    cleanPlaylistFromRecentTracks(AI_CONFIG.SPOTIFY_PLAYLIST_ID, days);
  } finally {
    // Здымаем блакіроўку
    lock.releaseLock();
  }
}


/**
 * Бясплатны (ручны) метад генерацыі.
 * Збірае гісторыю, просіць AI згенераваць спіс і захоўвае яго ў .txt файл на Google Drive.
 */
function generateTextMixToDrive() {
  try {
    Logger.log('Пачатак генерацыі тэкставага плэйліста...');
    
    // 1. Чытаем базу густу (Лайкі)
    const allTracks = Cache.read('SavedTracks.json');
    if (!allTracks || allTracks.length === 0) {
      Logger.log('⚠️ Файл SavedTracks.json пусты або не знойдзены.');
      return;
    }
    
    // 2. Бярэм 500 выпадковых трэкаў для аналізу
    const randomTracks = Selector.sliceRandom(allTracks, 500);
    const promptText = createTrackRecommendationPrompt_(JSON.stringify(randomTracks));
    
    // 3. Выклікаем Gemini
    Logger.log('🧠 Зварот да AI...');
    const aiResult = callGeminiTextAPI(promptText);
    const rawAiTracks = parseAiResponse(aiResult.responseText);
    
    if (!rawAiTracks || rawAiTracks.length === 0) {
      Logger.log('⚠️ AI не вярнуў трэкі. Магчыма, памылка парсінгу.');
      return;
    }
    
    Logger.log(`✅ AI прапанаваў ${rawAiTracks.length} трэкаў.`);
    
    // 4. Захоўваем як тэкставы файл у Google Drive (тэчка "Goofy Data")
    const fileName = 'AI_Daily_Mix.txt';
    const textContent = rawAiTracks.join('\n'); // Злучаем масіў радкоў з пераносам радка
    
    Cache.write(fileName, textContent);
    
    Logger.log(`🎉 Гатова! Файл "${fileName}" паспяхова захаваны ў вашым Google Drive (шукайце ў тэчцы "Goofy Data" ці падтэчцы з вашым ID).`);

  } catch (error) {
    Logger.log(`❌ КРЫТЫЧНАЯ ПАМЫЛКА: ${error.toString()}`);
  }
}
