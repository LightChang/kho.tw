// transform/normalize/taoyuan-cc-portal.mjs
// 桃園社大聯合網站 → L1 Course（見 transform/L1-FORMAT.md）
//
// 列表層能給的就是：課名、主辦社大、期別、類型、類別、開課日期＋星期＋時段、優惠。
// 來源沒有的（一律不填）：報名狀態、已報名人數、名額、費用、地址、教師、課程代碼。
// 招生人數與完整門牌只在詳情頁，ingest 那層說明了為什麼不在每輪抓。
const WEEKDAY = { 星期一: 1, 星期二: 2, 星期三: 3, 星期四: 4, 星期五: 5, 星期六: 6, 星期日: 7 };
const SEASON = [[/秋/, 'autumn'], [/春/, 'spring'], [/暑/, 'summer'], [/寒/, 'winter']];

// 「115-秋季班」「116-春季班」「115-暑期班」
function parseTerm(raw) {
  const text = (raw ?? '').trim();
  const year = Number(text.match(/(\d{3})/)?.[1]);
  if (!year) return undefined;
  const season = (SEASON.find(([re]) => re.test(text)) || [])[1];
  const term = { raw: text, year };
  if (season) term.season = season;
  return term;
}

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (!r?.courseId || !r.courseName) continue;
    const weekday = WEEKDAY[(r.weekdayText ?? '').trim()];
    const course = {
      _source: 'taoyuan-cc-portal',
      _sourceRecordId: r.courseId, // 32 hex，全站唯一
      _fetchedAt: fetchedAt,
      title: r.courseName.trim(),
      provider: { nameRaw: (r.organizer ?? '').trim(), kind: 'community-college' },
      schedule: {
        recurrence: 'weekly',
        slots: weekday ? [{ weekday }] : [], // 只有星期，時刻要進詳情頁才有
      },
      // 來源完全不回報報名狀態，不是「招生中」也不是「額滿」
      enrollment: { status: 'unknown' },
      // 五所主辦社大都是桃園市立案，但列表沒有上課地址，精度只到縣市
      location: { city: '桃園市', addressPrecision: 'city' },
      sourceUrl: r.detailUrl || `https://ta.twcc.org.tw/front/course_detail.php?id=${r.courseId}`,
    };
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.startDate ?? '')) course.schedule.startDate = r.startDate;
    const timeOfDay = (r.timeOfDay ?? '').trim();
    if (timeOfDay) course.schedule.timeInfoRaw = timeOfDay; // 只有「早上／下午／晚上」這種粗略時段
    const category = (r.categoryText ?? '').trim();
    if (category) course.categoryRaw = category;
    const courseType = (r.courseTypeText ?? '').trim();
    if (courseType) course.courseTypeRaw = courseType; // 實體課程／數位線上課程／混成課程／線上課程
    const term = parseTerm(r.semesterText);
    if (term) course.term = term;
    // 「🔥 5 折」「🎉 免學分費」只是優惠標示，沒有金額，不足以推 price／isFree
    const discount = (r.discountText ?? '').replace(/^[🔥🎉]\s*/u, '').trim();
    if (discount) course.topicsRaw = [discount];
    out.push(course);
  }
  return out;
}
