// transform/normalize/xuanen-centers.mjs
// 軒恩報名系統（運動中心）→ L1 Course（見 transform/L1-FORMAT.md）
// 這是本專案唯一有「可報名人數」數字的來源之一，名額逐日變動屬於 observation 的變更軌跡。
import { readFileSync } from 'node:fs';

const SITES = JSON.parse(
  readFileSync(new URL('../../overrides/xuanen-sites.json', import.meta.url), 'utf-8'),
);
const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7 };
// 類別代碼 → 名稱，取自課表頁 rbn_2 的 radio label（2026-09-11 實測）
const CATEGORY = {
  2: '有氧系列', 3: '瑜珈系列', 4: '舞蹈系列', 5: '飛輪系列', 7: '專業運動',
  9: '武術系列', 10: '公益系列', 13: '球類課程', 14: '泳訓團體', 17: '水中運動',
};

// 課程代碼首碼帶期別資訊的站點不一致，期別改由課程起訖日推：運動中心是雙月期別
function termOf(dateBegin) {
  if (!dateBegin) return undefined;
  const d = new Date(`${dateBegin}T00:00:00+08:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  const year = d.getFullYear() - 1911;
  const termNo = Math.floor(d.getMonth() / 2) + 1; // 1-2月=1期、3-4月=2期…
  return { raw: `${year}${String(termNo).padStart(2, '0')}`, year, termNo };
}

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (!r?.courseCode || !r._site) continue;
    const site = SITES[r._site] ?? {};
    const slot = { };
    if (WEEKDAY[r.weekday]) slot.weekday = WEEKDAY[r.weekday];
    if (r.timeBegin) slot.startTime = r.timeBegin;
    if (r.timeEnd) slot.endTime = r.timeEnd;
    const course = {
      _source: 'xuanen-centers',
      _sourceRecordId: `${r._site}:${r.courseCode}`,
      _fetchedAt: fetchedAt,
      title: r.courseName,
      externalIds: { centerCourseCode: r.courseCode },
      provider: {
        nameRaw: site.venueName ?? r._site,
        kind: 'sports-center',
        operatorRaw: r._operator,
      },
      schedule: {
        startDate: r.dateBegin || undefined,
        endDate: r.dateEnd || undefined,
        recurrence: 'weekly',
        slots: Object.keys(slot).length ? [slot] : [],
      },
      enrollment: {
        // 這套系統不回報「招生中／額滿」文字，狀態由名額推導
        status: r.available === 0 ? 'full' : r.available > 0 ? 'open' : 'unknown',
      },
      location: {
        // 站點還沒對到場館名時，用站台代碼當前綴——否則各中心的「游泳池」「韻律教室」
        // 會被場館層當成同一個場地合在一起（實測「游泳池」曾聚出 339 門課）。
        venueNameRaw: `${site.venueName ?? r._site} ${r.classroom ?? ''}`.trim(),
        addressPrecision: 'venue-name-only',
      },
    };
    const term = termOf(r.dateBegin);
    if (term) course.term = term;
    if (CATEGORY[r._category]) course.categoryRaw = CATEGORY[r._category];
    if (r.teacher) course.teachers = [{ nameRaw: r.teacher }];
    if (r.capacity != null) course.enrollment.capacity = r.capacity;
    if (r.available != null) course.enrollment.available = r.available;
    if (site.site) course.sourceUrl = `https://${site.site}`;
    out.push(course);
  }
  return out;
}
