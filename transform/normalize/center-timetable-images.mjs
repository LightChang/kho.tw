// transform/normalize/center-timetable-images.mjs
// 圖片課表（新莊、中和、五股國民運動中心）→ L1 Course（見 transform/L1-FORMAT.md）
//
// ingest 已經把圖讀成固定欄位並驗證過（ingest/sources/_vision.mjs），這裡只做欄位對應：
// - 名額：圖上只有「7-10 人」「4-12人」這類開班人數區間，不是總名額也不是剩餘，依 CONTRACT §5 不填；
//   報名狀態一律 unknown。
// - 起訖日：圖上有寫才有（新莊、中和有；五股的簡章只寫「2026.11-12月」，不填日期）。
// - 期別：有起始日照 xuanen／teamxports 同一套雙月期別推；沒有起始日就用簡章標示的起始月份。
// - 類別：ingest 的 category 是運動項目（游泳、瑜珈…），細項頁的 categoryMatch 靠它認出
//   只寫「幼兒專班」「兒童班」的泳訓課。
// - 教師：「中心專業師資」「洛德團隊」這類不是人名，不收。
import { CENTERS } from '../../ingest/sources/center-timetable-images.mjs';

const termFromMonth = (ym) => {
  if (!/^\d{4}-\d{2}/.test(ym ?? '')) return undefined;
  const [y, m] = ym.split('-').map(Number);
  const termNo = Math.floor((m - 1) / 2) + 1;
  return { raw: `${y - 1911}${String(termNo).padStart(2, '0')}`, year: y - 1911, termNo };
};

export function normalize(records, { fetchedAt }) {
  const out = [];
  const seen = new Set();
  for (const r of records) {
    const center = CENTERS[r?._center];
    if (!center || !r.title || !Array.isArray(r.weekdays) || !r.startTime) continue;
    const title = String(r.title).trim();
    const termMonth = r.startDate?.slice(0, 7) ?? r._periodStartMonth ?? null;
    const key = r.code ? String(r.code).trim() : `${title}|${r.weekdays.join('')}|${r.startTime}`;
    const id = `${r._center}:${termMonth ?? r._docKey}:${key}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const [, district] = center.address.match(/^新北市(.{1,3}?區)/) ?? [];
    const course = {
      _source: 'center-timetable-images',
      _sourceRecordId: id,
      _fetchedAt: fetchedAt,
      title,
      provider: { nameRaw: center.name, kind: 'sports-center', operatorRaw: center.operator },
      schedule: {
        startDate: r.startDate ?? undefined,
        endDate: r.endDate ?? undefined,
        recurrence: 'weekly',
        slots: r.weekdays.map((d) => ({ weekday: d, startTime: r.startTime, ...(r.endTime ? { endTime: r.endTime } : {}) })),
      },
      enrollment: { status: 'unknown' },
      location: {
        venueNameRaw: `${center.name} ${r.place ?? ''}`.trim(),
        city: '新北市',
        ...(district ? { district } : {}),
        addressPrecision: district ? 'district' : 'city',
      },
      sourceUrl: r._docUrl,
    };
    const extra = [r.sessions ? `共 ${r.sessions} 堂` : '', r.note ?? ''].filter(Boolean).join('；');
    if (extra) course.schedule.timeInfoRaw = extra;
    if (r.code) course.externalIds = { centerCourseCode: String(r.code).trim() };
    const category = r.category ?? r.section;
    if (category) course.categoryRaw = String(category).trim();
    if (r.audience) course.audienceRaw = String(r.audience).trim();
    if (r.teacher && !/師資|團隊|教練群|協調/.test(r.teacher)) course.teachers = [{ nameRaw: String(r.teacher).trim() }];
    if (Number.isInteger(r.price)) {
      if (r.price === 0) course.isFree = true;
      else course.price = r.price;
      course.priceText = `${r.price} 元${r.sessions ? `／${r.sessions} 堂` : ''}`;
    }
    const term = termFromMonth(termMonth);
    if (term) course.term = term;
    out.push(course);
  }
  return out;
}
