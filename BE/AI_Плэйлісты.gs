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

/**
 * Сціскае сырыя аб'екты з SavedTracks.json да кампактнага спісу "Artist - Track Name"
 * для эканоміі токенаў і паскарэння адказу API.
 */
function compactTracksForAi_(tracks) {
  return tracks
    .map(item => {
      if (typeof item === 'string') return item;
      const t = item && item.track ? item.track : item;
      const artist = t?.artists?.[0]?.name || t?.artist || '';
      const title = t?.name || t?.title || '';
      return artist && title ? `${artist} - ${title}` : null;
    })
    .filter(Boolean);
}

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

    // 1. Бярэм і сціскаем трэкі
    const allTracks = Cache.read('SavedTracks.json');
    const randomTracks = Selector.sliceRandom(allTracks, AI_CONFIG.TRACK_SAMPLE_SIZE_FOR_AI);
    const compactTracks = compactTracksForAi_(randomTracks);
    const { systemInstruction, userPrompt } = createTrackRecommendationPrompt_(JSON.stringify(compactTracks));

    // 2. Выклік AI з AI_Агульнае.gs
    const aiResult = callGeminiTextAPI(userPrompt, { systemInstruction });
    const rawAiTracks = parseAiResponse(aiResult.responseText);
    
    if (rawAiTracks.length === 0) return;

    // 3. Бронебітны пошук з AI_Агульнае.gs
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

  // Абнаўленне назвы і выклік генератара вокладкі з AI_Агульнае.gs
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

  const systemInstruction = `## Функцыя
Сфарміраваць персаналізаваны плэйліст дакладна з ${total} рэальных трэкаў, даступных у каталогу Spotify, на аснове гісторыі праслухоўвання карыстальніка (Input DNA) і каляндарнага кантэксту.

## Стратэгія міксавання (дакладныя прапорцыі для ${total} трэкаў)
Раўнамерна размеркуй чатыры катэгорыі па ўсім спісе:
1. **Core Matches (~${coreCount} трэкаў):** Малавядомыя песні (Deep Cuts, B-sides — не галоўныя хіты) любімых выканаўцаў карыстальніка, а таксама новыя падобныя па гучанні артысты, якіх карыстальнік яшчэ не ведае.
2. **Pivots (~${pivotCount} трэкаў):** Сумежныя жанры і іншыя эпохі (напрыклад, калі база — індзі-рок, прапануй French Coldwave або Neo-Psychedelia) па прынцыпе "Best Of" — сусветна прызнаныя эталоны новага жанру.
3. **Belarus Spotlight (~${belarusCount} трэкаў):** Беларуская музыка (сучасная або класіка), якая ідэальна пасуе да асноўнага вайбу (напрыклад: да пост-панку — Nürnberg / Molchat Doma
