// 場館頁的「這個地點」摘要：歷年開過哪些類別、哪些單位用過、通常開在哪些時段、同區還有哪些上課地點。
//
// 2026-09-30：很多曝光來自門牌查詢（「苗栗縣竹南鎮福德路1號」「臺北市大同區承德路三段230號」），
// 落地的場館頁只有「來源只給了門牌」和幾門課。這裡把這個地點自己的課聚合起來回答
// 「這個地址在開什麼課」——和講師頁（2026-09-29）同一套作法：只用已收錄課程的公開欄位，
// 不寫課程資料以外的推測（不猜建物用途、不補交通方式）。距離是兩個座標的直線距離，頁面上寫明。

export const DAYPART = ['上午', '下午', '晚上'];
const WEEKDAY_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };

const countBy = (items) => [...items.reduce((m, k) => (k ? m.set(k, (m.get(k) ?? 0) + 1) : m), new Map())]
  .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));

/**
 * 一門課的上課時段 [{ weekday, startTime }]。
 * 結構化的 schedule.slots 優先；沒有時才讀來源原文 timeInfoRaw 裡明寫的「星期六09:00」這種寫法
 * （職訓課幾乎都只有原文）。「平日(週一~週五)上午下午」這種沒有明確星期＋時間的不讀。
 */
export function slotsOf(c) {
  const slots = (c.schedule?.slots ?? []).filter((s) => s.weekday >= 1 && s.weekday <= 7);
  if (slots.length) return slots.map((s) => ({ weekday: s.weekday, startTime: s.startTime ?? null }));
  const raw = c.schedule?.timeInfoRaw ?? '';
  const out = [];
  for (const m of raw.matchAll(/(?:星期|週|周|禮拜)([一二三四五六日天])\s*(\d{1,2})[:：](\d{2})/g)) {
    out.push({ weekday: WEEKDAY_NUM[m[1]], startTime: `${m[2].padStart(2, '0')}:${m[3]}` });
  }
  return out;
}

/** 開始時刻 → 上午／下午／晚上（晚上＝17:00 起，與講師頁「週間晚上」同一條線） */
export function daypartOf(startTime) {
  if (!/^\d{2}:\d{2}$/.test(startTime ?? '')) return null;
  if (startTime < '12:00') return '上午';
  return startTime < '17:00' ? '下午' : '晚上';
}

/** 開課年份（西元）：開課日優先，沒有就用來源的學期（民國年） */
export const yearOf = (c) => (c.schedule?.startDate ? Number(c.schedule.startDate.slice(0, 4)) : null)
  || (c.term?.year ? c.term.year + 1911 : null);

const spanOf = (years) => {
  const ys = [...new Set(years.filter(Boolean))].sort();
  if (!ys.length) return '';
  return ys.length > 1 ? `${ys[0]}–${ys.at(-1)}` : `${ys[0]}`;
};

/**
 * 這個地點全部課程（不分學期）的摘要。
 * @param list 這個地點的課程
 * @param opts.actsOf 課程 → 細項名稱陣列
 * @param opts.kindLabel 開課單位類型代碼 → 中文
 */
export function venueProfile(list, { actsOf = () => [], kindLabel = new Map() } = {}) {
  const years = list.map(yearOf);
  const byYear = countBy(years.map((y) => y && String(y))).sort((a, b) => a[0].localeCompare(b[0]));

  const categories = countBy(list.map((c) => c.category));
  const acts = countBy(list.flatMap((c) => actsOf(c)));

  const byProvider = new Map();
  for (const c of list) {
    const name = c.provider?.nameRaw;
    if (!name) continue;
    const r = byProvider.get(name) ?? { name, kind: kindLabel.get(c.provider.kind) ?? null, n: 0, years: [], cats: [] };
    r.n += 1;
    r.years.push(yearOf(c));
    r.cats.push(c.category);
    byProvider.set(name, r);
  }
  const providers = [...byProvider.values()]
    .map((r) => ({ name: r.name, kind: r.kind, n: r.n, span: spanOf(r.years), cats: countBy(r.cats).slice(0, 3).map(([k]) => k) }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));

  // 時段：一門課一週上兩天，兩天各算一次；同一門課同一個時段只算一次
  const weekdays = new Map();
  const dayparts = new Map();
  let timed = 0;
  for (const c of list) {
    const slots = slotsOf(c);
    if (!slots.length) continue;
    timed += 1;
    for (const wd of new Set(slots.map((s) => s.weekday))) weekdays.set(wd, (weekdays.get(wd) ?? 0) + 1);
    for (const dp of new Set(slots.map((s) => daypartOf(s.startTime)).filter(Boolean))) dayparts.set(dp, (dayparts.get(dp) ?? 0) + 1);
  }
  const weekend = list.filter((c) => { const s = slotsOf(c); return s.length && s.every((x) => x.weekday >= 6); }).length;
  const weekday = list.filter((c) => { const s = slotsOf(c); return s.length && s.every((x) => x.weekday <= 5); }).length;

  return {
    total: list.length,
    span: spanOf(years),
    byYear,
    categories,
    acts,
    providers,
    timed,
    weekend,
    weekday,
    weekdays: [...weekdays].sort((a, b) => b[1] - a[1] || a[0] - b[0]),
    dayparts: DAYPART.filter((k) => dayparts.has(k)).map((k) => [k, dayparts.get(k)]),
  };
}

/** 兩點直線距離（公尺） */
export function distanceM(a, b) {
  if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return null;
  const R = 6371e3;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 行政區不明的地點，改用座標找同縣市、直線 3 公里內的地點
export const NEARBY_RADIUS_M = 3000;

/**
 * 同一行政區的其他上課地點。
 * - 有行政區：同縣市＋同行政區；兩邊都有座標時依直線距離排，否則依課程數
 * - 沒有行政區但有座標：同縣市、直線 NEARBY_RADIUS_M 內
 * - 座標完全相同的地點照列，距離欄寫「座標相同」：可能是同一處的不同寫法，也可能是門牌定位到同一點，
 *   資料分不出來，所以不替讀者判斷
 * @param v 本場館
 * @param pages 全部場館頁 [{ venue, list }]
 * @param byArea `${city}\t${district}` → 場館頁陣列（呼叫端預先分好，避免每頁掃全表）
 */
export function nearbyVenues(v, pages, { byArea, max = 10 } = {}) {
  let pool;
  let basis;
  if (v.city && v.district) {
    pool = byArea?.get(`${v.city}\t${v.district}`) ?? pages.filter((p) => p.venue.city === v.city && p.venue.district === v.district);
    basis = 'district';
  } else if (v.city && v.lat != null) {
    pool = pages.filter((p) => p.venue.city === v.city && (distanceM(v, p.venue) ?? Infinity) <= NEARBY_RADIUS_M);
    basis = 'radius';
  } else {
    return { basis: null, rows: [], total: 0 };
  }
  const rows = pool
    .filter((p) => p.venue.id !== v.id)
    .map((p) => ({ ...p, m: distanceM(v, p.venue) }));
  rows.sort((a, b) => (a.m ?? Infinity) - (b.m ?? Infinity) || b.list.length - a.list.length || a.venue.id.localeCompare(b.venue.id));
  return { basis, rows: rows.slice(0, max), total: rows.length };
}

/** 直線距離的顯示：1 公里內寫公尺（取整到 10 公尺），以上寫公里到小數一位 */
export const fmtDistance = (m) => (m == null ? '' : m < 1 ? '座標相同' : m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} 公尺` : `${Number((m / 1000).toFixed(1))} 公里`);
