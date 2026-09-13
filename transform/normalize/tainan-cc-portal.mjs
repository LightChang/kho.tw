// transform/normalize/tainan-cc-portal.mjs
// 臺南市社區大學校務資訊系統 → L1 Course（見 transform/L1-FORMAT.md）
//
// 期別：七校各自維護，`termText` 是該校頁面自己宣告的值（「115年度 秋季班」），
// 逐筆照填，不拿曾文的當期去套其他六校。實測分布：
//   115年度秋季班 503（曾文）／114年度秋季班 301（臺南）／115年度春季班 276（北門＋新化＋永康）
//   ／114年度春季班 80（南關）。舊期別的課 schedule.endDate 早就過了，下游要濾有依據。
//
// 名額：來源沒有任何名額或報名人數（人數上限只在詳情頁，而詳情頁不在每輪抓），
// 所以 capacity 與 available 一律不填——寧可空著也不拿其他欄位湊（CONTRACT §5）。
//
// 報名狀態：來源唯一的旗標是 `[不開班]`（停開）→ cancelled，其餘一律 unknown。
// **不用上課結束日推「已截止」**：那是拿上課期間冒充報名期間（CONTRACT §5 的已知陷阱）。
//
// 時刻：永康 76 門的上課時間全是 `00:00~00:00`（該校沒填），那不是凌晨零點，
// 是缺值，所以只留星期、不填 startTime／endTime。
const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7 };
const SEASON = [[/秋/, 'autumn'], [/春/, 'spring'], [/暑/, 'summer'], [/寒/, 'winter']];

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s || undefined;
};

// 「115年度 秋季班」
function parseTerm(raw) {
  const text = String(raw ?? '').replace(/\s+/g, '');
  const year = Number(text.match(/(\d{3})年度/)?.[1]);
  if (!year) return undefined;
  const term = { raw: text, year };
  const season = (SEASON.find(([re]) => re.test(text)) || [])[1];
  if (season) term.season = season;
  return term;
}

// 「2026-08-24~2027-01-30」
function parseDates(dateText) {
  const m = String(dateText ?? '').match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
  return m ? { startDate: m[1], endDate: m[2] } : {};
}

// 「08:50~10:30」；永康那批 00:00~00:00 視為缺值
function parseTimes(timeText) {
  const m = String(timeText ?? '').match(/(\d{1,2}):(\d{2})\s*~\s*(\d{1,2}):(\d{2})/);
  if (!m) return {};
  const pad = (h, mi) => `${String(Number(h)).padStart(2, '0')}:${mi}`;
  const startTime = pad(m[1], m[2]);
  const endTime = pad(m[3], m[4]);
  if (startTime === '00:00' && endTime === '00:00') return {};
  return { startTime, endTime };
}

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (!r?.courseId) continue;
    const title = clean(r.title);
    if (!title) continue;

    const weekday = WEEKDAY[String(r.gridWeekdayText ?? '').match(/星期([一二三四五六日])/)?.[1]];
    const times = parseTimes(r.timeText);
    const slot = weekday ? { weekday, ...times } : null;

    const course = {
      _source: 'tainan-cc-portal',
      _sourceRecordId: String(r.courseId),
      _fetchedAt: fetchedAt,
      title,
      provider: { nameRaw: clean(r.schoolName) ?? '臺南市社區大學', kind: 'community-college' },
      schedule: {
        recurrence: 'weekly',
        slots: slot ? [slot] : [],
        ...parseDates(r.dateText),
      },
      // 停開是來源明講的，和「來源不回報」不同（L1-FORMAT §2.2）
      enrollment: { status: r.statusRaw ? 'cancelled' : 'unknown' },
      // 列表沒有上課地址（紅字教室欄七校全空），精度只到縣市
      location: { city: '臺南市', addressPrecision: 'city' },
      sourceUrl: r.url || undefined,
    };
    if (slot) course.schedule.sessionsPerWeek = 1;
    const statusRaw = clean(r.statusRaw);
    if (statusRaw) course.enrollment.statusRaw = statusRaw;

    const term = parseTerm(r.termText);
    if (term) course.term = term;

    const teachers = String(r.teacherText ?? '')
      .split(/[、,，\s／/]+/).map((t) => t.trim()).filter(Boolean)
      .map((nameRaw) => ({ nameRaw }));
    if (teachers.length) course.teachers = teachers;

    const room = clean(r.roomText);
    if (room) {
      course.location.venueNameRaw = room;
      course.location.addressPrecision = 'venue-name-only';
    }
    out.push(course);
  }
  return out;
}
