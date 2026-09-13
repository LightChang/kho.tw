// transform/normalize/hualien-cc.mjs
// 花蓮縣社區大學（cloudschool）→ L1 Course（見 transform/L1-FORMAT.md）
// 和 taichung-cc 同一套廠商系統，欄位語意相同：列表的「21 / 20」是「已報名 / 名額」，
// 所以 capacity 取後者、available 由兩者相減（不可對調，剩餘名額是首頁「快額滿」的來源）。
// 實測有 21/20 這種超收，相減會是負數，一律夾到 0。
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
    // 一格可能列多個星期（「星期五 (全天) 星期六 (全天) 星期日 (全天)」），全部收成 slot。
    // 時段只有「全天／上午」這種粗略字樣，沒有時刻，所以 slot 只有 weekday。
    const slots = [...new Set((r.timeText ?? '').match(/星期[一二三四五六日]/g) ?? [])]
      .map((w) => ({ weekday: WEEKDAY[w] }))
      .filter((s) => s.weekday);
    const course = {
      _source: 'hualien-cc',
      _sourceRecordId: `${r._semester}:${r.courseId}`,
      _fetchedAt: fetchedAt,
      title: r.courseName.trim(),
      provider: { nameRaw: (r.school ?? '').trim(), kind: 'community-college' },
      schedule: {
        recurrence: 'weekly',
        slots,
        timeInfoRaw: (r.timeText ?? '').trim(),
      },
      enrollment: {
        status: STATUS[r.statusText?.trim()] ?? 'unknown',
        statusRaw: (r.statusText ?? '').trim(),
      },
      location: { city: '花蓮縣', addressPrecision: 'city' }, // 列表沒有地址
      sourceUrl: `https://hualien.cloudschool.com.tw/view/${r.courseId}`,
    };
    if (slots.length) course.schedule.sessionsPerWeek = slots.length;
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
