// src/lib/facets.mjs
// 建置期的三種細分：細項（皮拉提斯、水電…）、證照班、場館的顯示名稱。
// 都是純函式，不讀檔（規則由呼叫端傳進來），test/facets.test.mjs 直接拿來測。
//
// 為什麼另外做細項，不擴充 overrides/taxonomy.json 的 18 類：
//   18 類是「課程主題」的大分類，一門課只屬於一類；讀者搜的卻是「桃園皮拉提斯」「高雄水電課程」
//   這種細項＋地區。細項可以重疊（拳擊有氧同時是拳擊與有氧），粒度也不同，兩套分開維護。

/** 規則檔（overrides/activities.json）編譯成可比對的物件。 */
export function compileActivities(json) {
  return json.activities.map((a) => ({
    name: a.name,
    label: a.label ?? a.name,
    topic: a.topic ?? null,
    aliases: a.aliases ?? [],
    match: new RegExp(a.match, 'i'),
    exclude: a.exclude ? new RegExp(a.exclude, 'i') : null,
  }));
}

/** 一門課屬於哪些細項。只看課名：描述常順帶提到瑜珈、伸展，拿來判斷會歸錯。 */
export function activitiesOf(course, activities) {
  const title = course.title ?? '';
  return activities.filter((a) => a.match.test(title) && !(a.exclude && a.exclude.test(title)));
}

// ── 證照班 ─────────────────────────────────────
// 課名直接寫明考照、檢定，或是法定證照訓練（堆高機、職安衛管理員、照顧服務員…）。
const CERT_TITLE = /證照|檢定|丙級|乙級|甲級|單一級|技術士|執照|考照|證書班|認證班|堆高機|起重機|吊掛|職業安全衛生管理|安全衛生業務主管|急救人員|防火管理人|租賃住宅管理人員|照顧服務員|保母人員/;
// 描述要講到「輔導／報考／取得」某種證照或檢定才算。單寫「結業證書」「研習證明」是上完課的證明，不是證照。
const CERT_DESC = /(考取|取得|報考|輔導|考照|應考|參加|通過)[^。，；\n]{0,14}(證照|執照|技術士|技能檢定|檢定考|丙級|乙級|甲級|單一級)|技術士技能檢定|[乙丙]級技術士/;

export function isCert(course) {
  return CERT_TITLE.test(course.title ?? '') || CERT_DESC.test(course.description ?? '');
}

// ── 地名的口語寫法 ─────────────────────────────
// 標題要對上讀者打的字：「桃園皮拉提斯」「內湖增肌減脂」，不是「桃園市皮拉提斯」。
// 臺→台 也是：讀者打「台中」遠多於「臺中」。頁面內文仍用正式全名。
export function shortCity(city) {
  if (!city) return '';
  const s = city.replace(/^臺/, '台');
  // 嘉義市／嘉義縣、新竹市／新竹縣只差一字，去掉就分不出來，保留原樣
  if (/^(嘉義|新竹)/.test(s)) return s;
  return s.replace(/[市縣]$/, '');
}

export function shortDistrict(district) {
  if (!district) return '';
  // 「東區」「北區」這種兩字行政區去掉「區」就只剩方位，保留
  return district.length > 2 ? district.replace(/[區鎮鄉市]$/, '') : district;
}

// ── 場館的顯示名稱 ─────────────────────────────
// 全站約四成的場館在來源裡只有門牌（職訓、社大的上課地址），頁面標題因此只有一串地址。
// 名稱只從兩個地方來，都不自己編：
//   1. overrides/venue-names.json：人工查證過的地點名稱
//   2. 這個地點上課的開課單位（課程資料的 provider）——只說「某某單位的上課地點」，
//      不宣稱那就是該單位的會址。
//
// 「只有門牌」的判斷：去掉門牌號碼之後，剩下的要以路、街、段、巷、弄、里、鄰收尾，
// 而且中間沒有「：」「-」這類把地點名稱和地址隔開的符號（「公民教室：承德路4段190號」有名稱）。
// 不用「含不含館、中心」這種字眼判斷：「桃園區」「公園路」「文化南路」本身就含這些字。
export function isBareAddress(name) {
  if (!name || !/\d+號/.test(name)) return false;
  if (/[：:\-—（(【]/.test(name)) return false;
  const rest = name.replace(/臨?[\d０-９、,之至附－\-]+號.*$/, '');
  // 鄉下的門牌常是「某某村＋小地名＋號」（古坑鄉荷苞厝8號），沒有路名
  return /(路|街|大道|段|巷|弄|村|里|鄰)$/.test(rest) || /[縣市區鄉鎮村里鄰][^縣市區鄉鎮村里鄰]{1,4}$/.test(rest);
}

/** 開課單位依課程數排序：[{ name, n }] */
export function providersOf(list) {
  const m = new Map();
  for (const c of list) {
    const p = c.provider?.nameRaw;
    if (p) m.set(p, (m.get(p) ?? 0) + 1);
  }
  return [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

/**
 * 場館頁要用的名稱。
 * @returns {{ name: string, heading: string, placeName: string|null, from: 'source'|'override'|'provider'|'providers', providers: {name:string,n:number}[] }}
 *   name：原本的場館名（來源寫法，不動）
 *   heading：H1／標題用的完整寫法
 *   placeName：查得到的地點名稱（沒有就 null）
 */
export function venueDisplay(venue, list, overrides = {}) {
  const providers = providersOf(list);
  const name = venue.name;
  const o = overrides[venue.id];
  if (o?.name) {
    return { name, heading: isBareAddress(name) ? `${o.name}（${name}）` : o.name, placeName: o.name, from: 'override', providers };
  }
  if (!isBareAddress(name)) return { name, heading: name, placeName: null, from: 'source', providers };
  const top = providers[0];
  if (top && top.n / list.length >= 0.6) {
    return { name, heading: `${name}（${top.name}上課地點）`, placeName: null, from: 'provider', providers };
  }
  if (providers.length) {
    const few = providers.slice(0, 2).map((p) => p.name).join('、');
    return { name, heading: `${name}（${few}${providers.length > 2 ? `等 ${providers.length} 個單位` : ''}的上課地點）`, placeName: null, from: 'providers', providers };
  }
  return { name, heading: name, placeName: null, from: 'source', providers };
}

// ── 學期標籤 ───────────────────────────────────
// 期別字串各來源寫法不一（1151、115-秋季班、11505…），不拿來當標題。
// 改用開課日推：2–6 月開課＝春季、7–8 月＝暑期、9–12 月＝秋季、1 月＝冬季。
export function seasonOf(date) {
  if (!date) return null;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  if (!y || !m) return null;
  const s = m === 1 ? '冬季' : m <= 6 ? '春季' : m <= 8 ? '暑期' : '秋季';
  return `${y} ${s}`;
}

/** 一組課程裡最多門課所在的學期，例如「2026 秋季」。 */
export function mainSeason(list) {
  const m = new Map();
  for (const c of list) {
    const s = seasonOf(c.schedule?.startDate);
    if (s) m.set(s, (m.get(s) ?? 0) + 1);
  }
  return [...m].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] ?? null;
}

// ── 課程頁標題 ─────────────────────────────────

const normTai = (s) => String(s ?? '').replace(/臺/g, '台');
const cityRoot = (city) => normTai(city).replace(/[市縣]$/, '');

/** 名稱裡已經有縣市（或口語縣市）就不必再補 */
export const mentionsCity = (text, city) => Boolean(city) && normTai(text).includes(cityRoot(city));

/**
 * 課程頁的 <title>：「課名｜開課單位（縣市） 2026 秋季」。
 * 同名同單位的課很多（全站約四成），光看課名與單位分不出是哪一期、哪一班。
 * - 學期由開課日推（seasonOf），沒有開課日就不寫
 * - 單位名看不出縣市時補口語縣市
 * - collide：同課名、同單位、同學期還有別門課時，補第一個上課時段（週六 19:00）
 */
export function courseTitle(c, { collide = false, weekdayLabel = [] } = {}) {
  const p = c.provider?.nameRaw ?? '';
  const city = c.venue?.city;
  let t = p ? `${c.title}｜${p}` : c.title;
  if (city && !mentionsCity(p, city)) t += p ? `（${shortCity(city)}）` : `｜${city}`;
  const s = seasonOf(c.schedule?.startDate);
  if (s) t += ` ${s}`;
  if (collide) {
    const slot = (c.schedule?.slots ?? []).find((x) => x.weekday >= 1 && x.weekday <= 7);
    if (slot) t += ` ${weekdayLabel[slot.weekday] ?? ''}${slot.startTime ? ` ${slot.startTime}` : ''}`.trimEnd();
  }
  return t;
}

/** 課名去掉期數、班別與空白：同名課（不分單位）的比對鍵。 */
export function courseTitleKey(c) {
  return String(c.title ?? '')
    .replace(/[【\[(（][^】\])）]*(開課|期|梯)[^】\])）]*[】\])）]/g, '')
    .replace(/第?\s*[0-9０-９一二三四五六七八九十]+\s*[期梯]次?/g, '')
    .replace(/[\s\p{P}\p{S}]/gu, '')
    .toLowerCase();
}

/** 同一門課的「期別鍵」：同名課鍵＋單位。用來找同一門課的下一期。 */
export function courseSeriesKey(c) {
  return `${courseTitleKey(c)}|${c.provider?.nameRaw ?? ''}`;
}
