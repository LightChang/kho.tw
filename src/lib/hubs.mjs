// src/lib/hubs.mjs
// 需求專題頁的歸類規則（站主 2026-09-28 拍板新增，見 docs/GROWTH.md §1.3）：
//   /program/產投.html、/program/職前訓練.html（職訓方案）
//   /free.html、/free/<縣市>.html（來源標示免費的課）
//   /senior.html、/senior/<縣市>.html（銀髮・樂齡課）
// 都是純函式、不讀檔，test/hubs.test.mjs 直接拿來測。只收「還沒上完」的課：
// 這幾頁回答的是「現在有什麼課」，上完的課放進來只會把表格灌滿過期資料。

// 職訓方案：看台灣就業通的 PlanName（provider.planRaw）。
// mol-6060 開放資料沒有方案欄，但資料集本身就是勞動力發展署的職前訓練（its.taiwanjobs 的課），
// 所以沒有 planRaw 的 mol-6060 課歸職前訓練。
export const PROGRAMS = [
  {
    key: '產投',
    name: '產業人才投資方案',
    short: '產投課程',
    match: (c) => c.provider?.planRaw === '產業人才投資方案',
  },
  {
    key: '職前訓練',
    name: '職前訓練',
    short: '職前訓練課程',
    match: (c) => /職前/.test(c.provider?.planRaw ?? '')
      || (c.provider?.kind === 'vocational' && !c.provider?.planRaw && (c.sources ?? []).some((s) => s.id === 'mol-6060')),
  },
];

/** 免費：只認來源明講的免費（isFree，學員負擔 0 元）；沒有費用資料的課不算。報名已截止、停開的不列。 */
export const isFreeNow = (c) => c.isFree === true && !['closed', 'cancelled'].includes(c.enrollment?.status);

// 銀髮・樂齡：樂齡中心的課全收；其他單位看課名（樂齡、銀髮、長青、熟齡、高齡者專班）或來源的對象欄寫「樂齡」。
// 職訓課只收寫明「高齡者專班」「中高齡」的——「樂齡活動帶領員」「樂齡健身指導員」是培訓照顧長輩的人，不是給長輩上的課。
const SENIOR_TITLE = /樂齡|銀髮|長青|熟齡|高齡者專班|銀力/;
const SENIOR_VOCATIONAL = /高齡者專班|中高齡/;
export function isSenior(c) {
  const title = c.title ?? '';
  if (c.provider?.kind === 'senior-center') return true;
  if (c.provider?.kind === 'vocational') return SENIOR_VOCATIONAL.test(title);
  return SENIOR_TITLE.test(title) || /^樂齡/.test(c.audienceRaw ?? '');
}

/**
 * 一組課程依縣市切開，只留課數達門檻的縣市，多的在前。
 * @returns {{ city: string, list: object[] }[]}
 */
export function splitByCity(list, min) {
  const m = new Map();
  for (const c of list) {
    const city = c.venue?.city;
    if (!city) continue;
    if (!m.has(city)) m.set(city, []);
    m.get(city).push(c);
  }
  return [...m].filter(([, l]) => l.length >= min)
    .map(([city, l]) => ({ city, list: l }))
    .sort((a, b) => b.list.length - a.list.length || a.city.localeCompare(b.city));
}

/** 報名表排序：招生中（截止日近的先）→ 尚未開放（開放日近的先）→ 其他，同組再依開課日。 */
const PHASE = { open: 0, upcoming: 1 };
export const byEnrollDeadline = (a, b) => (PHASE[a.enrollment?.status] ?? 2) - (PHASE[b.enrollment?.status] ?? 2)
  || String((a.enrollment?.status === 'upcoming' ? a.enrollment?.opensAt : a.enrollment?.closesAt) ?? '9')
    .localeCompare(String((b.enrollment?.status === 'upcoming' ? b.enrollment?.opensAt : b.enrollment?.closesAt) ?? '9'))
  || String(a.schedule?.startDate ?? '9').localeCompare(String(b.schedule?.startDate ?? '9'));

/**
 * 營運單位獨佔一個細項×地區頁時的簡稱（「臺北市內湖運動中心」→「內湖運動中心」）。
 * 只看運動中心：讀者會打「內湖運動中心游泳課」，不會打「某某社大游泳課」。
 * 同一個運動中心佔該頁六成以上才回傳，否則 null。
 */
export function dominantSportsCenter(list, share = 0.6) {
  const m = new Map();
  for (const c of list) {
    if (c.provider?.kind !== 'sports-center' || !c.provider?.nameRaw) continue;
    m.set(c.provider.nameRaw, (m.get(c.provider.nameRaw) ?? 0) + 1);
  }
  const top = [...m].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] / list.length < share || !/運動(中心|園區)/.test(top[0])) return null;
  return { name: top[0], short: shortCenter(top[0]), n: top[1] };
}

export function shortCenter(name) {
  return name
    .replace(/^(臺北|台北|新北|桃園|臺中|台中|臺南|台南|高雄|基隆|新竹|嘉義|宜蘭|花蓮|臺東|台東|屏東|彰化|雲林|南投|苗栗|澎湖|金門|連江)[市縣]立?/, '')
    .replace(/國民暨兒童運動中心|國民運動中心/, '運動中心');
}
