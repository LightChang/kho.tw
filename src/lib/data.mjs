// src/lib/data.mjs
// 建置期資料層：讀管線產出的 ndjson／json，算好各頁要的清單。所有頁面與 sitemap 整合都從這裡取。
//
// 輸入：data/courses.ndjson、data/venues.ndjson、data/slugs.ndjson、public/home.json、overrides/taxonomy.json
//
// 為什麼結果掛在 globalThis 而不是模組層級變數：
//   Astro 會把 getStaticPaths 抽成獨立 chunk，同一支模組可能被打包進好幾個 chunk，
//   模組層級的快取各算各的——33,315 門課、50 MB 的 ndjson 就會被讀好幾次。
//   globalThis 在同一個建置行程裡只有一份。
//
// 開發用：KHO_LIMIT=N 只產前 N 筆課程頁（取代舊版 site/build.mjs 的 --limit）。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { collectTeachers, teachersWithPages, MIN_COURSES, cleanName, SPLIT_KEEP } from '../../transform/teachers.mjs';
import { todayTaipei } from '../../transform/_date.mjs';
import { readdirSync } from 'node:fs';
import { courseChangedAt, courseFirstSeen } from '../../site/sitemap.mjs';
import { PROGRAMS, isFreeNow, isSenior, splitByCity, byEnrollDeadline, shortCenter } from './hubs.mjs';
import { compileActivities, activitiesOf, isCert, venueDisplay, mainSeason, seasonOf, courseSeriesKey, courseTitleKey } from './facets.mjs';

const ROOT = process.cwd();

export { MIN_COURSES };

export const STATUS_LABEL = {
  open: '招生中', upcoming: '尚未開放報名', full: '額滿', running: '開課中',
  closed: '報名已截止', cancelled: '停開', unknown: '狀態未知',
};
export const WEEKDAY_LABEL = ['', '週一', '週二', '週三', '週四', '週五', '週六', '週日'];
// 可報名的排前面，已結束的排後面
const STATUS_ORDER = { open: 0, upcoming: 1, running: 2, full: 3, unknown: 4, closed: 5, cancelled: 6 };

// 「上課已經結束」與「報名狀態」是兩件事，這裡只講前者。
//
// ingest/CONTRACT.md §5 明訂：拿上課結束日去推「報名已截止」是用上課期間冒充報名期間，
// 不可以。所以**不動 enrollment.status**——那是來源說的事實，來源沒說就是 unknown。
// 但全站 16,448 門狀態未知的課裡，有 10,767 門的上課結束日早就過了，
// 頁面上只寫「狀態未知」會讓人以為說不定還報得到。排程日期是我們手上確實有的事實，
// 照實寫出來即可，不必也不該去改報名狀態。
export const TODAY = todayTaipei();
export const hasEnded = (c) => Boolean(c.schedule?.endDate) && c.schedule.endDate < TODAY;

// 站內連結：slug 是中文，每一段都要百分比編碼（與 site/sitemap.mjs 的 toLoc() 同一套規則）。
export const link = (dir, slug) => `/${dir}/${encodeURIComponent(slug)}.html`;
export const fmt = (n) => Number(n ?? 0).toLocaleString('en-US');

// 已經上完的課一律排到最後，再依報名狀態、再依開課日新到舊。
// 先前只看 status，結果「狀態未知」（排序 4）的一萬多門過期課會插在
// 額滿（3）與已截止（5）之間，把還報得到的課往下擠。
export const byStatusThenDate = (a, b) => (hasEnded(a) - hasEnded(b))
  || (STATUS_ORDER[a.enrollment?.status] ?? 9) - (STATUS_ORDER[b.enrollment?.status] ?? 9)
  || String(b.schedule?.startDate ?? '').localeCompare(String(a.schedule?.startDate ?? ''));

export const isOpen = (c) => c.enrollment?.status === 'open';

// 上課結束滿一年的課程頁：noindex,follow 並移出 sitemap（站主 2026-09-27 拍板）。
// 頁面保留、連結照走；180–365 天的不動，靠頁首「新一期」卡片承接流量。
export const NOINDEX_AFTER_DAYS = 365;
export const isNoindex = (c) => hasEnded(c)
  && (Date.parse(TODAY) - Date.parse(c.schedule.endDate)) / 864e5 >= NOINDEX_AFTER_DAYS;

// 細項頁與證照頁的門檻：課太少的組合不出頁，免得產出一堆只有一兩門課的薄頁。
// 全國細項 20 門、縣市 8 門、行政區 10 門；證照班縣市頁 8 門。
// 縣市 8 門是看過實際查詢才定的：「彰化拳擊課程」剛好 8 門，再高就接不到。
export const FACET_MIN = { national: 20, city: 8, district: 10, certCity: 8 };

// 細項頁網址：/learn/皮拉提斯.html、/learn/皮拉提斯/桃園市.html、/learn/瑜珈/臺北市內湖區.html
export const learnRel = (name, area) => (area ? `learn/${name}/${area}.html` : `learn/${name}.html`);
export const learnHref = (name, area) => `/${learnRel(name, area).split('/').map(encodeURIComponent).join('/')}`;
export const certRel = (city) => (city ? `cert/${city}.html` : 'cert.html');
export const certHref = (city) => `/${certRel(city).split('/').map(encodeURIComponent).join('/')}`;

// 需求專題頁網址（規則見 hubs.mjs）：/program/產投.html、/program/產投/臺北市.html、/free/臺中市.html、/senior/臺北市.html
const relOf = (dir, top, city) => (city ? `${dir}/${top ? `${top}/` : ''}${city}.html` : `${top ? `${dir}/${top}` : dir}.html`);
const hrefOf = (rel) => `/${rel.split('/').map(encodeURIComponent).join('/')}`;
export const programRel = (key, city) => relOf('program', key, city);
export const programHref = (key, city) => hrefOf(programRel(key, city));
export const freeRel = (city) => relOf('free', '', city);
export const freeHref = (city) => hrefOf(freeRel(city));
export const seniorRel = (city) => relOf('senior', '', city);
export const seniorHref = (city) => hrefOf(seniorRel(city));
// 銀髮・樂齡 × 行政區（2026-10-02）：/senior/臺北市/中正區.html，接「中正區銀髮族體適能」這種到區的問法。門檻同細項行政區頁。
export const seniorDistrictRel = (city, district) => `senior/${city}/${district}.html`;
export const seniorDistrictHref = (city, district) => hrefOf(seniorDistrictRel(city, district));

// 場館 × 細項頁（站主 2026-10-02 拍板）：/at/<場館 slug>/<細項>.html，例如 /at/臺中市北屯國民暨兒童運動中心-xxxxx/皮拉提斯.html。
// 接「北屯運動中心 皮拉提斯」這種「場館名＋細項」的查詢。網址由場館 slug（登記簿配給、不會變）＋細項名
// （overrides/activities.json 的 name）組成，兩者都穩定。不放在 /venue/ 底下，是為了讓 seo-ops 的頁組
// （watchGroups 以網址前綴分組）能把這種頁和場館頁分開算每百頁點擊。
// 門檻與場館頁頁內細項分段相同：本期同細項 ≥3 門才出頁，場館頁那一段就連過來。
export const VENUE_ACT_MIN = 3;
export const venueActRel = (venueSlug, name) => `at/${venueSlug}/${name}.html`;
export const venueActHref = (venueSlug, name) => `/${venueActRel(venueSlug, name).split('/').map(encodeURIComponent).join('/')}`;

// 場館頁的「本期」：還沒上完的課，加上 90 天內才開課的課（有些來源的結束日寫在開課日之前）。
// 場館頁課表與場館 × 細項頁共用這一個定義。
const VENUE_CURRENT_DAYS = 90;
export const venueCutoff = new Date(Date.parse(`${TODAY}T00:00:00Z`) - VENUE_CURRENT_DAYS * 864e5).toISOString().slice(0, 10);
export const isVenueCurrent = (c) => !hasEnded(c) || (c.schedule?.startDate ?? '') >= venueCutoff;

// 薄場館頁 noindex,follow＋移出 sitemap（站主 2026-10-02 拍板）：總共 ≤2 門課、而且一門還沒結束的課都沒有。
// 頁面保留、連結照走，不 404；之後這個地點又有新課，下一輪 build 自動恢復收錄。
// 「還沒結束」用 hasEnded 判斷：沒有結束日的課當作還沒結束，寧可多收也不誤殺。
export const VENUE_THIN_MAX = 2;
export const isThinVenue = (list) => list.length <= VENUE_THIN_MAX && list.every(hasEnded);

const readNdjson = (file) => readFileSync(file, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const readJson = (file) => JSON.parse(readFileSync(file, 'utf-8'));

function groupBy(list, keyOf) {
  const out = new Map();
  for (const item of list) {
    const key = keyOf(item);
    if (key === undefined || key === null) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(item);
  }
  return out;
}

function load() {
  const courses = readNdjson(path.join(ROOT, 'data', 'courses.ndjson'));
  const venues = new Map(readNdjson(path.join(ROOT, 'data', 'venues.ndjson')).map((v) => [v.id, v]));

  // 課程的 slug 在 data/courses.ndjson 裡，場館的沒有（venues.ndjson 是 relations 那一層寫的），
  // 所以場館的 slug 從登記簿補上。缺了就直接停，不要默默產出一堆 /venue/undefined.html。
  const slugFile = path.join(ROOT, 'data', 'slugs.ndjson');
  let slugRows;
  try {
    slugRows = readNdjson(slugFile);
  } catch {
    throw new Error(`找不到 ${slugFile}，請先跑 node transform/emit.mjs`);
  }
  const venueSlugs = new Map(slugRows.filter((r) => r.kind === 'venue').map((r) => [r.id, r.slug]));
  for (const v of venues.values()) {
    v.slug = venueSlugs.get(v.id);
    if (!v.slug) throw new Error(`場館 ${v.id} 在 data/slugs.ndjson 沒有 slug，請重跑 node transform/emit.mjs`);
  }
  const noSlug = courses.filter((c) => !c.slug).length;
  if (noSlug) throw new Error(`${noSlug} 門課的 data/courses.ndjson 沒有 slug，請重跑 node transform/emit.mjs`);

  const home = readJson(path.join(ROOT, 'public', 'home.json'));

  // 觀測層的內容變更日與初見日（sitemap lastmod 與「新上架」用）。只留兩個日期，不留 payload。
  const obsDir = path.join(ROOT, 'data', 'observation');
  const obs = new Map();
  for (const f of readdirSync(obsDir).filter((n) => n.endsWith('.ndjson')).sort()) {
    for (const line of readFileSync(path.join(obsDir, f), 'utf-8').split('\n')) {
      if (!line) continue;
      const o = JSON.parse(line);
      obs.set(o.id, { changed: o.lastChangedAt ?? undefined, first: o.firstObservedAt ?? undefined });
    }
  }
  const changedAt = new Map(courses.map((c) => [c.id, courseChangedAt(c, obs)]));
  const firstSeen = new Map(courses.map((c) => [c.id, courseFirstSeen(c, obs)]));
  // 主題分類的清單與顯示順序以 overrides/taxonomy.json 為準（只讀不改），
  // 不從課程資料反推——反推的話某一類剛好沒課就會整類消失，順序也會跟著資料飄。
  const taxonomy = readJson(path.join(ROOT, 'overrides', 'taxonomy.json'));

  // ── 現在可報名，依縣市分組 ─────────────────────
  const openCourses = courses.filter(isOpen);
  // 最近新上架：招生中的課依本站初見日新到舊，同一天再依開課日。/open.html、縣市頁、首頁連結用。
  const byNewest = (a, b) => String(firstSeen.get(b.id) ?? '').localeCompare(String(firstSeen.get(a.id) ?? ''))
    || String(b.schedule?.startDate ?? '').localeCompare(String(a.schedule?.startDate ?? ''))
    || a.slug.localeCompare(b.slug);
  const newestOpen = openCourses.filter((c) => firstSeen.get(c.id)).sort(byNewest);
  const newestOpenByCity = groupBy(newestOpen, (c) => c.venue?.city);
  const weekAgo = new Date(Date.parse(`${TODAY}T00:00:00Z`) - 7 * 864e5).toISOString().slice(0, 10);
  const newThisWeek = newestOpen.filter((c) => firstSeen.get(c.id) > weekAgo).length;
  const openByCity = [...groupBy(openCourses, (c) => c.venue?.city ?? '未標示縣市')]
    .sort((a, b) => b[1].length - a[1].length);

  // ── 類型 ───────────────────────────────────────
  const types = home.types.map((kind) => ({
    ...kind,
    list: courses.filter((c) => c.provider?.kind === kind.kind).sort(byStatusThenDate),
  }));

  // ── 主題分類 ───────────────────────────────────
  // 這 18 類是「課程主題」（overrides/taxonomy.json），與「機構類型」是兩個不同的面向：
  // 同一門瑜伽課，類型是「社區大學」、主題是「運動健身」。兩套索引各自獨立，不互相取代。
  //
  // categoryFrom === 'title'（依課名推斷）的課一律收進來，不另設篩選：
  // 全站 18 類裡推斷佔 15,025 門、來源標示 11,735 門，排掉推斷的會讓多數分類頁少掉一半以上，
  // 索引就失去「我要學語言」的入口功能。但推斷是我們的判斷、不是來源講的事實，
  // 所以在卡片上標明「分類依課名判斷」，分類頁開頭也寫出這一類有幾門是推斷的。
  const byCategory = new Map(taxonomy.categories.map((name) => [name, []]));
  for (const c of courses) {
    if (!c.category) continue;
    const list = byCategory.get(c.category);
    // 資料出現 taxonomy 沒有的分類就直接停：默默丟掉的話，分類頁會少課而沒有任何徵兆。
    if (!list) throw new Error(`課程 ${c.slug} 的分類「${c.category}」不在 overrides/taxonomy.json 的 categories 裡`);
    list.push(c);
  }
  const topics = [...byCategory].filter(([, list]) => list.length)
    .map(([name, list]) => ({
      name,
      list: list.sort(byStatusThenDate),
      open: list.filter(isOpen).length,
      inferred: list.filter((c) => c.categoryFrom === 'title').length,
    }));
  const categorised = topics.reduce((n, t) => n + t.list.length, 0);

  // ── 縣市 ───────────────────────────────────────
  const cities = [...groupBy(courses, (c) => c.venue?.city)].map(([name, list]) => ({
    name,
    list: list.sort(byStatusThenDate),
    open: list.filter(isOpen).length,
  }));

  // ── 場館 ───────────────────────────────────────
  // 場館名稱只有門牌的，用 overrides/venue-names.json 或開課單位補一個看得懂的標題（見 facets.mjs）
  const venueNames = readJson(path.join(ROOT, 'overrides', 'venue-names.json')).venues ?? {};
  const venuePages = [...groupBy(courses, (c) => c.venue?.id)]
    .filter(([id]) => venues.has(id))
    .map(([id, list]) => ({
      venue: venues.get(id),
      list: list.sort(byStatusThenDate),
      display: venueDisplay(venues.get(id), list, venueNames),
      noindex: isThinVenue(list),
    }));

  // ── 地圖 ───────────────────────────────────────
  // 場館為單位聚合，不是課程——19,671 門有座標的課只落在 1,782 個地點上，
  // 按場館聚合後資料從 1.3 MB 降到 78 KB，地圖也不會同一個點疊幾十個標記。
  // 欄位是陣列不是物件，省體積：[slug, 場館名, 縣市, 行政區, lat, lng, 課程數, 招生中數]
  const mapRows = [];
  let mapCourses = 0;
  let mapOpen = 0;
  for (const { venue: v, list } of venuePages) {
    if (v.lat == null || v.lng == null) continue;
    const open = list.filter(isOpen).length;
    mapCourses += list.length;
    mapOpen += open;
    mapRows.push([
      v.slug, v.name, v.city ?? '', v.district ?? '',
      // 小數 5 位約 1 公尺，遠超過本站座標實際的精度，再多位數只是灌大檔案
      Number(v.lat.toFixed(5)), Number(v.lng.toFixed(5)),
      list.length, open,
    ]);
  }
  mapRows.sort((a, b) => b[6] - a[6] || String(a[0]).localeCompare(String(b[0])));

  // ── 講師 ───────────────────────────────────────
  // 全站 8,672 個講師姓名原本只出現在課程頁的一列文字裡，沒有任何頁面回答得了
  // 「這位老師還開了哪些課」。身分認定＝姓名＋開課單位，規則與理由見 transform/teachers.mjs。
  // slug 由 emit 配給，這裡只讀；拿不到就是兩邊算出的身分不一致，直接停——
  // 默默跳過的話會少掉一批頁面，而且畫面上不會有任何徵兆。
  const teacherSlugs = new Map(slugRows.filter((r) => r.kind === 'teacher').map((r) => [r.id, r.slug]));
  const teacherIndex = collectTeachers(courses);
  const pageTeachers = teachersWithPages(teacherIndex);
  for (const t of pageTeachers) {
    t.slug = teacherSlugs.get(t.id);
    if (!t.slug) throw new Error(`講師「${t.name}」（${t.provider}）在 data/slugs.ndjson 沒有 slug，請重跑 node transform/emit.mjs`);
  }
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const teachersByName = groupBy(pageTeachers, (t) => t.name);
  const teachers = pageTeachers.map((t) => {
    const list = t.courseIds.map((id) => courseById.get(id)).filter(Boolean).sort(byStatusThenDate);
    return {
      teacher: t,
      list,
      open: list.filter(isOpen).length,
      sameName: (teachersByName.get(t.name) ?? []).filter((o) => o.id !== t.id),
    };
  });
  // 講師索引：頁面數上千，不可能全列在一頁上，所以只列開課最多的 300 位，
  // 其餘靠課程頁的「講師的其他課程」與 sitemap 進入——和類型／縣市頁「只列前 300」同一套作法。
  const rankedTeachers = pageTeachers.slice()
    .sort((a, b) => b.courseIds.length - a.courseIds.length || a.id.localeCompare(b.id));

  // 課程 → 有頁面的講師。講師頁的入站連結全部來自這裡。
  const teacherPagesByCourse = groupBy(
    pageTeachers.flatMap((t) => t.courseIds.map((id) => ({ id, t }))),
    (x) => x.id,
  );

  /**
   * 課程的講師欄逐段拆開，有講師頁的那一段給連結：[[{ text, href? }, …], …]（一個來源字串一組）。
   * 分隔符原樣保留、各段文字不動（含頭銜、括號綽號），只是多包一層連結——講師欄一字不改。
   * 比對規則與講師頁身分認定同一套（cleanName），只連到「這門課」的講師頁，同名不同單位的不會連錯。
   */
  const teacherSegmentsOf = (c) => {
    const pages = teacherPagesByCourse.get(c.id) ?? [];
    return (c.teachers ?? []).map((t) => String(t.nameRaw ?? '').split(SPLIT_KEEP).filter((x) => x !== '').map((text, i, arr) => {
      const p = pages.find((x) => x.t.name === cleanName(text));
      return p && !SPLIT_KEEP.test(text) ? { text, href: link('teacher', p.t.slug) } : { text };
    }));
  };

  // ── 細項（皮拉提斯、水電…）× 地區 ───────────────
  const activities = compileActivities(readJson(path.join(ROOT, 'overrides', 'activities.json')));
  const actsByCourse = new Map(courses.map((c) => [c.id, activitiesOf(c, activities).map((a) => a.name)]));
  const summarize = (list) => ({ list: list.sort(byStatusThenDate), open: list.filter(isOpen).length, season: mainSeason(list) });
  const learn = [];
  for (const a of activities) {
    const list = courses.filter((c) => actsByCourse.get(c.id).includes(a.name));
    if (list.length < FACET_MIN.national) continue;
    const cities = [...groupBy(list, (c) => c.venue?.city)]
      .filter(([, l]) => l.length >= FACET_MIN.city)
      .map(([city, l]) => ({ city, district: null, area: city, ...summarize(l) }))
      .sort((x, y) => y.list.length - x.list.length);
    const districts = [...groupBy(list.filter((c) => c.venue?.city && c.venue?.district), (c) => `${c.venue.city}\t${c.venue.district}`)]
      .filter(([, l]) => l.length >= FACET_MIN.district)
      .map(([key, l]) => {
        const [city, district] = key.split('\t');
        return { city, district, area: `${city}${district}`, ...summarize(l) };
      })
      .sort((x, y) => y.list.length - x.list.length);
    learn.push({ activity: a, ...summarize(list), cities, districts });
  }
  // 由課程找回它所屬的細項頁：課程頁、場館頁的內部連結都從這裡來
  const learnPageSet = new Set(learn.flatMap((l) => [
    l.activity.name,
    ...l.cities.map((x) => `${l.activity.name}/${x.area}`),
    ...l.districts.map((x) => `${l.activity.name}/${x.area}`),
  ]));
  const learnByName = new Map(learn.map((l) => [l.activity.name, l]));
  /** 一門課的細項連結：[{ href, text }]，由細到粗（行政區 → 縣市 → 全國） */
  const learnLinksOf = (c) => {
    const out = [];
    for (const name of actsByCourse.get(c.id) ?? []) {
      const l = learnByName.get(name);
      if (!l) continue;
      const { city, district } = c.venue ?? {};
      if (city && district && learnPageSet.has(`${name}/${city}${district}`)) out.push({ href: learnHref(name, `${city}${district}`), text: `${district}${l.activity.label}` });
      if (city && learnPageSet.has(`${name}/${city}`)) out.push({ href: learnHref(name, city), text: `${city}${l.activity.label}` });
      out.push({ href: learnHref(name), text: `${l.activity.label}（全台）` });
    }
    return out;
  };
  // ── 場館 × 細項（/at/<場館>/<細項>.html，規則見 VENUE_ACT_MIN 上方說明） ──
  // 只做有地點名稱的場館（來源本身有名稱，或 overrides 查證過）：只有門牌的地點沒有人會用「門牌＋細項」去搜。
  // 名稱太短或只是行政區名的也不做（「景美」「校本部」「臺北市」）：「景美瑜珈課程」讀者看不出是哪裡。
  // noindex 的薄場館不會到門檻（≤2 門），不必另外排除。
  const placeLike = (h) => [...h].length >= 4 && !/^\S{2,3}[市縣](\S{1,3}[區鄉鎮市])?$/.test(h);
  // 標題用讀者的叫法：「臺中市北屯國民暨兒童運動中心」→「北屯運動中心」；其他場館照原名
  const shortVenue = (h) => (/運動(中心|園區)/.test(h) && shortCenter(h)) || h;
  const venueActs = [];
  for (const p of venuePages) {
    if (p.display.from !== 'source' && p.display.from !== 'override') continue;
    if (!placeLike(p.display.heading)) continue;
    const cur = p.list.filter(isVenueCurrent);
    for (const a of activities) {
      const list = cur.filter((c) => actsByCourse.get(c.id).includes(a.name));
      if (list.length < VENUE_ACT_MIN) continue;
      venueActs.push({
        venue: p.venue, display: p.display, activity: a,
        short: shortVenue(p.display.heading),
        href: venueActHref(p.venue.slug, a.name), rel: venueActRel(p.venue.slug, a.name),
        ...summarize(list),
      });
    }
  }
  const venueActsByVenue = groupBy(venueActs, (x) => x.venue.id);
  for (const l of venueActsByVenue.values()) l.sort((x, y) => y.list.length - x.list.length);
  /** 細項 × 地區頁用：這個細項在這個縣市（district 給了就限該行政區）有哪些場館 × 細項頁，課多的在前 */
  const venueActsIn = (name, city, district) => venueActs
    .filter((x) => x.activity.name === name && x.venue.city === city && (!district || x.venue.district === district))
    .sort((x, y) => y.list.length - x.list.length);

  // ── 社大名錄（2026-10-04）：/type/community-college.html 依社大列出，連到各社大的主上課地點 ──
  // 「新竹社區大學課程表」原本落在一個門牌開頭的場館頁：讀者要找的是社大，頁面上卻只看得到地址。
  // 同一間社大在不同來源的寫法不一（「北投社區大學」「臺北市北投社區大學」「台北市北投社區大學」、
  // 「大屯社大」「臺中市大屯社區大學」），這裡合成一間。縣市前綴拿掉後同名的（雲林與臺中都有「海線社區大學」）
  // 用縣市分開。只改頁面標題與名錄，不動來源的開課單位欄。
  // 主上課地點＝本期課最多的場館（本期課都沒有地點資料就看全部），而且那個場館超過六成的課是這間社大開的
  // （與 venueDisplay 認定「某單位上課地點」同一個門檻）；場館被好幾間社大共用就不算誰的主地點。
  const CC_MAIN_SHARE = 0.6;
  const COUNTY = /^([臺台][北中南東]|新北|桃園|新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|高雄|基隆|澎湖|金門|連江)([縣市])/;
  const ccRaw = new Map();
  for (const c of types.find((k) => k.kind === 'community-college')?.list ?? []) {
    const raw = c.provider?.nameRaw;
    if (!raw) continue;
    if (!ccRaw.has(raw)) ccRaw.set(raw, []);
    ccRaw.get(raw).push(c);
  }
  const ccGroups = new Map();
  const ccKeyOfRaw = new Map();
  const unplaced = [];
  for (const [raw, list] of ccRaw) {
    const full = raw.replace(/社大$/, '社區大學').replace(/^台/, '臺');
    const m = full.match(COUNTY);
    const rest = m ? full.slice(m[0].length) : full;
    const name = m && rest !== '社區大學' ? rest : full;
    const cityCount = new Map();
    for (const c of list) if (c.venue?.city) cityCount.set(c.venue.city, (cityCount.get(c.venue.city) ?? 0) + 1);
    const city = m ? `${m[1]}${m[2]}` : [...cityCount].sort((a, b) => b[1] - a[1])[0]?.[0];
    // 「花蓮社大」與「花蓮縣社區大學」是同一間
    const key = `${city ?? ''}|${name.replace(/^(\S{2})[縣市]社區大學$/, '$1社區大學')}`;
    if (!city) { unplaced.push({ raw, key, name, list }); continue; }
    if (!ccGroups.has(key)) ccGroups.set(key, { key, city, names: [], list: [] });
    const g = ccGroups.get(key);
    g.names.push({ name, n: list.length });
    g.list.push(...list);
    ccKeyOfRaw.set(raw, key);
  }
  // 沒有任何地點資料的寫法：同名的社大只有一間時併過去，否則略過（沒有地點可連）
  for (const u of unplaced) {
    const same = [...ccGroups.values()].filter((g) => g.key.endsWith(u.key));
    if (same.length !== 1) continue;
    same[0].names.push({ name: u.name, n: u.list.length });
    same[0].list.push(...u.list);
    ccKeyOfRaw.set(u.raw, same[0].key);
  }
  const venuePageById = new Map(venuePages.map((p) => [p.venue.id, p]));
  const ccHubs = [];
  for (const g of ccGroups.values()) {
    const name = g.names.sort((a, b) => b.n - a.n || b.name.length - a.name.length)[0].name;
    const cur = g.list.filter(isVenueCurrent);
    const count = new Map();
    const placed = cur.filter((c) => c.venue?.id);
    for (const c of placed.length ? placed : g.list) if (c.venue?.id) count.set(c.venue.id, (count.get(c.venue.id) ?? 0) + 1);
    const top = [...count].sort((a, b) => b[1] - a[1])[0];
    const p = top && venuePageById.get(top[0]);
    const share = p ? p.display.providers.filter((x) => ccKeyOfRaw.get(x.name) === g.key).reduce((s, x) => s + x.n, 0) / p.list.length : 0;
    ccHubs.push({
      key: g.key, name, city: g.city, n: g.list.length, current: cur.length, open: cur.filter(isOpen).length,
      main: p && !p.noindex && share >= CC_MAIN_SHARE ? p : null, share,
    });
  }
  // 同名的社大在別的縣市也有：名錄與標題都加上縣市
  const ccNameCount = new Map();
  for (const h of ccHubs) ccNameCount.set(h.name, (ccNameCount.get(h.name) ?? 0) + 1);
  for (const h of ccHubs) if (ccNameCount.get(h.name) > 1) h.name = `${h.city}${h.name}`;
  ccHubs.sort((a, b) => b.current - a.current || b.n - a.n);
  /** 場館 id → 以這裡為主上課地點的社大（場館頁標題用）；同一個場館不會分給兩間（上面的六成門檻保證） */
  const ccByMainVenue = new Map(ccHubs.filter((h) => h.main).map((h) => [h.main.venue.id, h]));

  // 18 大類底下有哪些細項頁（主題頁用）、各縣市有哪些細項頁（縣市頁用）
  const learnByTopic = groupBy(learn, (l) => l.activity.topic);
  const learnByCity = new Map();
  for (const l of learn) for (const x of l.cities) {
    if (!learnByCity.has(x.city)) learnByCity.set(x.city, []);
    learnByCity.get(x.city).push({ activity: l.activity, n: x.list.length, open: x.open });
  }
  for (const list of learnByCity.values()) list.sort((a, b) => b.n - a.n);

  // ── 縣市頁的樞紐：行政區（連到該區的細項頁與上課地點）、主要上課地點 ──
  const learnByDistrict = new Map();
  for (const l of learn) for (const x of l.districts) {
    const k = `${x.city}\t${x.district}`;
    if (!learnByDistrict.has(k)) learnByDistrict.set(k, []);
    learnByDistrict.get(k).push({ activity: l.activity, area: x.area, n: x.list.length });
  }
  for (const l of learnByDistrict.values()) l.sort((a, b) => b.n - a.n);
  const venueRows = venuePages.filter((p) => !p.noindex).map((p) => ({
    venue: p.venue, display: p.display, n: p.list.length, current: p.list.filter((c) => !hasEnded(c)).length,
  }));
  /** 縣市頁用：{ districts: [{ district, n, current, learn, venues }], venues: [...] }，都依還沒結束的課數排 */
  const cityHubOf = (city) => {
    const rows = venueRows.filter((r) => r.venue.city === city)
      .sort((a, b) => b.current - a.current || b.n - a.n || a.venue.slug.localeCompare(b.venue.slug));
    const byDistrict = groupBy(rows.filter((r) => r.venue.district), (r) => r.venue.district);
    const districts = [...byDistrict].map(([district, vs]) => ({
      district,
      n: vs.reduce((t, r) => t + r.n, 0),
      current: vs.reduce((t, r) => t + r.current, 0),
      learn: learnByDistrict.get(`${city}\t${district}`) ?? [],
      venues: vs,
    })).sort((a, b) => b.current - a.current || b.n - a.n || a.district.localeCompare(b.district));
    return { districts, venues: rows };
  };

  // ── 證照班 ─────────────────────────────────────
  const certCourses = courses.filter(isCert).sort(byStatusThenDate);
  const certIds = new Set(certCourses.map((c) => c.id));
  const cert = {
    ...summarize(certCourses),
    cities: [...groupBy(certCourses, (c) => c.venue?.city)]
      .filter(([, l]) => l.length >= FACET_MIN.certCity)
      .map(([city, l]) => ({ city, ...summarize(l) }))
      .sort((x, y) => y.list.length - x.list.length),
  };
  const certCitySet = new Set(cert.cities.map((x) => x.city));

  // ── 需求專題：職訓方案、免費課、銀髮課（只收還沒上完的課，規則見 hubs.mjs） ──
  const current = courses.filter((c) => !hasEnded(c));
  const hub = (list) => ({
    list, open: list.filter(isOpen).length,
    cities: splitByCity(list, FACET_MIN.city).map((x) => ({ ...x, open: x.list.filter(isOpen).length })),
  });
  const programs = PROGRAMS.map((p) => ({ ...p, ...hub(current.filter(p.match).sort(byEnrollDeadline)) }));
  const free = hub(current.filter(isFreeNow).sort(byStatusThenDate));
  const senior = hub(current.filter((c) => isSenior(c) && c.enrollment?.status !== 'cancelled').sort(byStatusThenDate));
  senior.districts = [...groupBy(senior.list.filter((c) => c.venue?.city && c.venue?.district), (c) => `${c.venue.city}\t${c.venue.district}`)]
    .filter(([, l]) => l.length >= FACET_MIN.district)
    .map(([key, l]) => { const [city, district] = key.split('\t'); return { city, district, list: l, open: l.filter(isOpen).length }; })
    .sort((a, b) => b.list.length - a.list.length || a.district.localeCompare(b.district));
  /** 縣市頁用：這個縣市有哪些專題頁 [{ href, text, n }] */
  const hubLinksOf = (city) => [
    ...programs.map((p) => [p.cities.find((x) => x.city === city), programHref(p.key, city), `${city}${p.short}`]),
    [free.cities.find((x) => x.city === city), freeHref(city), `${city}免費課程`],
    [senior.cities.find((x) => x.city === city), seniorHref(city), `${city}銀髮・樂齡課程`],
  ].filter(([x]) => x).map(([x, href, text]) => ({ href, text, n: x.list.length }));

  // ── 課程頁標題的區分：同課名、同單位、同學期還有別門課時，標題補上課時段 ──
  const titleKey = (c) => `${c.title}|${c.provider?.nameRaw ?? ''}|${seasonOf(c.schedule?.startDate) ?? ''}`;
  const titleCount = new Map();
  for (const c of courses) titleCount.set(titleKey(c), (titleCount.get(titleKey(c)) ?? 0) + 1);
  const titleCollides = (c) => (titleCount.get(titleKey(c)) ?? 0) > 1;

  // ── 過期課程的去處：同一門課的新一期、同場館／同細項的本期課 ──
  const series = groupBy(courses, courseSeriesKey);
  /** 同一門課（課名去掉期數＋同單位）還沒結束、而且比這門晚開課的其他期 */
  const successorsOf = (c) => (series.get(courseSeriesKey(c)) ?? [])
    .filter((o) => o.id !== c.id && !hasEnded(o) && String(o.schedule?.startDate ?? '9') >= String(c.schedule?.startDate ?? ''))
    .sort((a, b) => String(a.schedule?.startDate ?? '').localeCompare(String(b.schedule?.startDate ?? '')))
    .slice(0, 3);
  const currentByVenue = groupBy(courses.filter((c) => !hasEnded(c)), (c) => c.venue?.id);
  const currentByCity = groupBy(courses.filter((c) => !hasEnded(c)), (c) => c.venue?.city);
  for (const m of [currentByVenue, currentByCity]) for (const l of m.values()) l.sort(byStatusThenDate);
  /** 過期課程頁的替代選項：同場館同細項 → 同場館同分類 → 同縣市同細項，最多 n 門 */
  const alternativesOf = (c, n = 6) => {
    const acts = new Set(actsByCourse.get(c.id) ?? []);
    const sharesAct = (o) => (actsByCourse.get(o.id) ?? []).some((a) => acts.has(a));
    const skip = new Set([c.id, ...successorsOf(c).map((o) => o.id)]);
    const out = [];
    const take = (list, pred, why) => {
      for (const o of list ?? []) {
        if (out.length >= n) return;
        if (skip.has(o.id) || !pred(o)) continue;
        skip.add(o.id);
        out.push({ course: o, why });
      }
    };
    const vl = currentByVenue.get(c.venue?.id);
    if (acts.size) take(vl, sharesAct, '同地點同類');
    if (c.category) take(vl, (o) => o.category === c.category, '同地點同類');
    if (acts.size) take(currentByCity.get(c.venue?.city), sharesAct, '同縣市同類');
    return out;
  };
  // ── 同名課程：同課名（去期數）的其他期別與其他開課單位，未結束的在前、同單位→同縣市優先 ──
  // 例：同一班的「第06期」頁和不帶期數的頁互不相連，搜尋結果各自掛在不同名次。
  const byTitle = groupBy(courses.filter((c) => courseTitleKey(c)), courseTitleKey);
  for (const l of byTitle.values()) l.sort((a, b) => (hasEnded(a) - hasEnded(b))
    || String(b.schedule?.startDate ?? '').localeCompare(String(a.schedule?.startDate ?? '')));
  const sameTitleOf = (c, n = 8) => {
    const l = byTitle.get(courseTitleKey(c)) ?? [];
    if (l.length < 2) return [];
    const rank = (o) => (o.provider?.nameRaw === c.provider?.nameRaw ? 0 : o.venue?.city && o.venue.city === c.venue?.city ? 1 : 2);
    const out = [[], [], []];
    for (const o of l) if (o.id !== c.id) out[rank(o)].push(o);
    return out.flat().slice(0, n);
  };
  const limit = process.env.KHO_LIMIT ? Number(process.env.KHO_LIMIT) : Infinity;
  const coursePages = courses.slice(0, limit).map((c) => ({
    course: c,
    venue: venues.get(c.venue?.id),
    teacherPages: (teacherPagesByCourse.get(c.id) ?? []).map((x) => x.t),
  }));

  return {
    courses, venues, home, taxonomy,
    openCourses, openByCity, types, topics, categorised, cities, venuePages,
    map: { rows: mapRows, courseCount: mapCourses, openCount: mapOpen },
    teacherIndex, pageTeachers, teachers, rankedTeachers, coursePages,
    activities, actsByCourse, learn, learnByName, learnByTopic, learnByCity, learnLinksOf,
    venueActs, venueActsByVenue, venueActsIn, cityHubOf, teacherSegmentsOf, ccHubs, ccByMainVenue,
    cert, certIds, certCitySet, programs, free, senior, hubLinksOf,
    titleCollides, successorsOf, alternativesOf, currentByVenue, sameTitleOf,
    changedAt, firstSeen, newestOpen, newestOpenByCity, newThisWeek,
  };
}

export function getData() {
  globalThis.__khoData ??= load();
  return globalThis.__khoData;
}
