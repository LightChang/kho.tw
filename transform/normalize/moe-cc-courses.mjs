// transform/normalize/moe-cc-courses.mjs
// 教育部全國社大網 → L1 Course（見 transform/L1-FORMAT.md）
//
// 這支是歷史層：實測建檔日落後開課日中位數 50 天，所以 enrollment.status 一律 unknown
// （來源的 teach_status 實測恆為 1，送 0 或 1 回傳筆數相同，代表它不回報停開）。
// 校內課程代碼（internal_course_code，跨來源合併的錨點）只在單筆詳情端點才有，
// 列表端點沒有，所以這一層產不出 externalIds，合併要靠 L2 的課名＋期別＋時段規則。

// course_tag_id_arr 的對照取自站方 utility/utility_func_proj.js 的 course_tag_name_arr
const TOPICS = {
  1: '性別平等', 2: '公民素養', 3: '人權法治', 4: '環境永續', 5: '媒體素養',
  6: '安全教育', 7: '生命教育', 8: '社區總體營造', 9: '新住民課程', 10: '國防教育',
  11: '本土語文', 12: '山野教育', 13: '美感教育', 14: '傳統藝術', 15: '民俗文化資產',
  16: '消費者保護', 17: '家庭教育', 18: '地方學', 19: '用藥安全', 20: '其他',
  21: '英語教育', 22: '非上述屬性', 23: '科技學習', 24: '代間學習',
  25: '高齡心理健康', 26: '交通安全',
};
// time_cat_id 對照取自課程查詢頁的 time_cat_arr
const RECURRENCE = { 11: 'weekly', 12: 'twice-weekly', 21: 'biweekly', 22: 'biweekly-twice', 99: 'irregular' };
const SEASON = { 1: 'spring', 2: 'autumn', 3: 'summer', 4: 'winter' };

const EMPTY_DATE = '0000-00-00';
const EMPTY_TIME = '00:00:00';
const hhmm = (t) => (t && t !== EMPTY_TIME ? t.slice(0, 5) : undefined);
// 來源的 weekday 0 是星期日（對照頁面的 weekday_short_tw），L1 統一用 ISO 1-7
const isoWeekday = (n) => (n === 0 ? 7 : Number(n));

function parseTerm(quarter) {
  const s = String(quarter ?? '');
  if (s.length !== 4) return undefined;
  const year = Number(s.slice(0, 3));
  const season = SEASON[Number(s.slice(3))];
  if (!year) return undefined;
  return season ? { raw: s, year, season } : { raw: s, year };
}

function slotsOf(r) {
  const slots = [];
  const first = { weekday: isoWeekday(r.weekday), startTime: hhmm(r.time_begin), endTime: hhmm(r.time_end) };
  if (first.startTime || Number.isFinite(first.weekday)) slots.push(first);
  if (String(r.time_cat_id).endsWith('2')) {
    const second = { weekday: isoWeekday(r.weekday_2), startTime: hhmm(r.time_2_begin), endTime: hhmm(r.time_2_end) };
    if (second.startTime) slots.push(second);
  }
  return slots.filter((s) => s.startTime || Number.isFinite(s.weekday));
}

export function normalize(records, { fetchedAt }) {
  const meta = records.find((r) => r?._kind === 'meta') ?? {};
  const regionOf = new Map(
    (meta.school_list ?? []).map((s) => [String(s.school_id), s.region_name]),
  );
  const out = [];
  for (const r of records) {
    if (!r || r._kind === 'meta' || r.course_id == null) continue;
    const address = (r.address ?? '').trim();
    const course = {
      _source: 'moe-cc-courses',
      _sourceRecordId: String(r.course_id),
      _fetchedAt: fetchedAt,
      title: (r.course_name ?? '').trim(),
      provider: { nameRaw: (r.school_name ?? '').trim(), kind: 'community-college' },
      schedule: { recurrence: RECURRENCE[r.time_cat_id] ?? 'irregular', slots: slotsOf(r) },
      enrollment: {
        // 來源不回報停開，所以不能把 teach_status=1 當成「還能報名」
        status: 'unknown',
        statusRaw: r.teach_status === 1 ? '正常開課' : String(r.teach_status ?? ''),
      },
      location: {
        addressPrecision: address ? (/\d+\s*號/.test(address) ? 'street' : 'venue-name-only') : 'none',
      },
    };
    if (r.date_begin && r.date_begin !== EMPTY_DATE) course.schedule.startDate = r.date_begin;
    if (r.date_end && r.date_end !== EMPTY_DATE) course.schedule.endDate = r.date_end;
    if (r.time_info) course.schedule.timeInfoRaw = String(r.time_info).trim();
    if (address) course.location.venueNameRaw = address;
    if (address && /\d+\s*號/.test(address)) course.location.address = address;
    const region = regionOf.get(String(r.school_id));
    if (region) course.location.city = region;
    const term = parseTerm(r._quarter ?? r.quarter);
    if (term) course.term = term;
    if (r.teacher_name) course.teachers = [{ nameRaw: String(r.teacher_name).trim() }];
    if (Number.isFinite(Number(r.price))) {
      course.price = Number(r.price);
      course.isFree = Number(r.price) === 0;
    }
    if (Number(r.credit) > 0) course.credit = Number(r.credit);
    if (String(r.course_url ?? '').startsWith('http')) course.sourceUrl = r.course_url;
    const topics = String(r.course_tag_id_arr ?? '')
      .split(';')
      .map((t) => TOPICS[Number(t)])
      .filter(Boolean);
    if (topics.length) course.topicsRaw = topics;
    out.push(course);
  }
  return out;
}
