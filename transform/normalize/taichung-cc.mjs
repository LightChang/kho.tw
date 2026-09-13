// transform/normalize/taichung-cc.mjs
// 臺中市社大共學 Full 聯網 → L1 Course（見 transform/L1-FORMAT.md）
// 這支有報名人數與名額數字（列表顯示 "33 / 50"），是名額觀測的來源之一。
const WEEKDAY = { 星期一: 1, 星期二: 2, 星期三: 3, 星期四: 4, 星期五: 5, 星期六: 6, 星期日: 7 };
const STATUS = {
  公布: 'open', 招生中: 'open', 已開課: 'running', 開課中: 'running',
  額滿: 'full', 已額滿: 'full', 停召: 'cancelled', 停招: 'cancelled', 停開: 'cancelled',
};
const SEASON = { 1: 'spring', 2: 'autumn', 3: 'winter', 4: 'summer' };

// "115 年度 - 第 2 學期 (秋)"
function parseTerm(label) {
  const year = Number(label?.match(/(\d{3})\s*年度/)?.[1]);
  const no = Number(label?.match(/第\s*(\d)\s*學期/)?.[1]);
  if (!year) return undefined;
  const term = { raw: label.replace(/\s+/g, ' ').trim(), year };
  if (SEASON[no]) term.season = SEASON[no];
  return term;
}

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (!r?.courseId || !r.courseName) continue;
    const weekday = WEEKDAY[r.timeText?.match(/星期[一二三四五六日]/)?.[0]];
    const course = {
      _source: 'taichung-cc',
      _sourceRecordId: `${r._semester}:${r.courseId}`,
      _fetchedAt: fetchedAt,
      title: r.courseName.trim(),
      provider: { nameRaw: (r.school ?? '').trim(), kind: 'community-college' },
      schedule: {
        recurrence: 'weekly',
        slots: weekday ? [{ weekday }] : [],
        timeInfoRaw: (r.timeText ?? '').trim(), // 只有「星期五 (早上)」這種粗略時段
      },
      enrollment: {
        status: STATUS[r.statusText?.trim()] ?? 'unknown',
        statusRaw: (r.statusText ?? '').trim(),
      },
      location: { city: '臺中市', addressPrecision: 'city' },
      sourceUrl: `https://cc.tc.edu.tw/view/${r.courseId}`,
    };
    const term = parseTerm(r._semesterLabel);
    if (term) course.term = term;
    if (Number.isFinite(r.capacity) && r.capacity !== null) {
      course.enrollment.capacity = r.capacity;
      if (Number.isFinite(r.enrolled) && r.enrolled !== null) {
        course.enrollment.enrolled = r.enrolled;
        course.enrollment.available = Math.max(0, r.capacity - r.enrolled);
        if (course.enrollment.available === 0 && course.enrollment.status === 'open') {
          course.enrollment.status = 'full';
        }
      }
    }
    const tags = [r.tagText, r.discountText].map((t) => (t ?? '').trim()).filter(Boolean);
    if (tags.length) course.topicsRaw = tags;
    out.push(course);
  }
  return out;
}
