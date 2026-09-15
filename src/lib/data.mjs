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
import { collectTeachers, teachersWithPages, MIN_COURSES } from '../../transform/teachers.mjs';
import { todayTaipei } from '../../transform/_date.mjs';

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
  // 主題分類的清單與顯示順序以 overrides/taxonomy.json 為準（只讀不改），
  // 不從課程資料反推——反推的話某一類剛好沒課就會整類消失，順序也會跟著資料飄。
  const taxonomy = readJson(path.join(ROOT, 'overrides', 'taxonomy.json'));

  // ── 現在可報名，依縣市分組 ─────────────────────
  const openCourses = courses.filter(isOpen);
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
  const venuePages = [...groupBy(courses, (c) => c.venue?.id)]
    .filter(([id]) => venues.has(id))
    .map(([id, list]) => ({ venue: venues.get(id), list: list.sort(byStatusThenDate) }));

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
  };
}

export function getData() {
  globalThis.__khoData ??= load();
  return globalThis.__khoData;
}
