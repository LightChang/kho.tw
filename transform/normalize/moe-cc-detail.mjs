// transform/normalize/moe-cc-detail.mjs
// 教育部全國社大網課程詳情 → L1 Course（見 transform/L1-FORMAT.md）
//
// 這支與 moe-cc-courses 是同一批課的兩個視角：列表給全量骨架，詳情多給
// internal_course_code（跨來源合併的錨點）與 course_intro（課程簡介）。
// 欄位對照與解析函式直接從列表那支 import，不另外寫一份。
//
// 兩支會在 L2 合併成同一群，不會變成兩門課：校名、期別、課名、星期、開始時刻
// 五項都出自同一筆來源資料、必然一致，命中 cluster.mjs 的 title-slot（0.9）規則。
// conflicts() 也擋不住它——0.9 高於 0.85 的門檻，而列表那支沒有代碼可資衝突。
// 詳情這支另外帶代碼，所以同時產生 1.0 的 `校名|期別|代碼` 鍵去對上臺北市聯網，
// 三方串成一群（實測抽樣 40 門命中 35 門）。
//
// enrollment.status 一律 unknown，理由與列表層相同：teach_status 實測恆為 1，
// 來源不回報停開（見 transform/normalize/moe-cc-courses.mjs 檔頭）。
//
// 不帶 location.city：詳情端點沒有 region 欄位，而列表那支有（靠 school_list 對照）。
// 兩支同群，投影時 bestLocation 會取資訊最完整的那筆，這裡硬湊縣市反而是猜。
import { TOPICS, RECURRENCE, EMPTY_DATE, parseTerm, slotsOf } from './moe-cc-courses.mjs';

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (!r || r.course_id == null) continue;
    const address = (r.address ?? '').trim();
    const course = {
      _source: 'moe-cc-detail',
      _sourceRecordId: String(r.course_id),
      _fetchedAt: fetchedAt,
      title: (r.course_name ?? '').trim(),
      provider: { nameRaw: (r.school_name ?? '').trim(), kind: 'community-college' },
      schedule: { recurrence: RECURRENCE[r.time_cat_id] ?? 'irregular', slots: slotsOf(r) },
      enrollment: {
        status: 'unknown',
        statusRaw: r.teach_status === 1 ? '正常開課' : String(r.teach_status ?? ''),
      },
      location: {
        addressPrecision: address ? (/\d+\s*號/.test(address) ? 'street' : 'venue-name-only') : 'none',
      },
    };
    // 接這支的頭號理由：cluster.mjs 的 1.0 規則靠它
    const code = String(r.internal_course_code ?? '').trim();
    if (code) course.externalIds = { schoolCourseCode: code };
    // 來源的簡介常被整段包在一對半形引號裡（實測 course_intro 開頭就是 "），去掉外層引號，
    // 內容本身一個字不動。
    const intro = String(r.course_intro ?? '').trim().replace(/^"([\s\S]*)"$/, '$1').trim();
    if (intro) course.description = intro;

    if (r.date_begin && r.date_begin !== EMPTY_DATE) course.schedule.startDate = r.date_begin;
    if (r.date_end && r.date_end !== EMPTY_DATE) course.schedule.endDate = r.date_end;
    if (r.time_info) course.schedule.timeInfoRaw = String(r.time_info).trim();
    if (address) course.location.venueNameRaw = address;
    if (address && /\d+\s*號/.test(address)) course.location.address = address;
    const term = parseTerm(r.quarter);
    if (term) course.term = term;
    if (r.teacher_name) course.teachers = [{ nameRaw: String(r.teacher_name).trim() }];
    if (Number.isFinite(Number(r.price))) {
      course.price = Number(r.price);
      course.isFree = Number(r.price) === 0;
    }
    if (Number(r.credit) > 0) course.credit = Number(r.credit);
    if (String(r.course_url ?? '').startsWith('http')) course.sourceUrl = r.course_url;
    // course_cat_name 是社大的行政三分類（生活藝能／學術／社團），不是科目，
    // 對照 overrides/taxonomy.json 只會全部落在 null，所以不寫進 categoryRaw。
    const topics = String(r.course_tag_id_arr ?? '')
      .split(';')
      .map((t) => TOPICS[Number(t)])
      .filter(Boolean);
    if (topics.length) course.topicsRaw = topics;
    out.push(course);
  }
  return out;
}
