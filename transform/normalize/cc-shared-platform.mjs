// transform/normalize/cc-shared-platform.mjs
// 社大共用報名平台 → L1 Course（見 transform/L1-FORMAT.md）
//
// 兩種版面的欄位多寡不同，正規化時一起吃：
//   week（週課表）：有課程代碼、上課時刻、招生人數、招生狀態、上課地址
//   box （圖片／條列）：只有課名、開課日期、時段、區域、期別、教師
// 週課表的「課程代碼」（例如 1152A1004-1）就是校內課程代碼，和教育部全國站的
// internal_course_code 是同一個體系，是 L2 分群 confidence 1.0 的錨點。
const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7 };
const STATUS = {
  招生中: 'open', 報名中: 'open', 額滿: 'full', 已額滿: 'full',
  開課中: 'running', 已開課: 'running', 停開: 'cancelled', 停招: 'cancelled',
  結束: 'closed', 已結束: 'closed',
};
const SEASON = [
  [/秋季?班?|秋季/, 'autumn'],
  [/春季?班?|春季/, 'spring'],
  [/暑期?班?|暑假/, 'summer'],
  [/寒假?班?|寒期/, 'winter'],
];

// "115-秋季班"、"115秋季班"
function parseTerm(raw) {
  if (!raw) return undefined;
  const year = Number(raw.match(/(\d{3})/)?.[1]);
  if (!year) return undefined;
  const season = (SEASON.find(([re]) => re.test(raw)) || [])[1];
  const term = { raw: raw.trim(), year };
  if (season) term.season = season;
  return term;
}

const num = (s) => {
  const m = String(s ?? '').match(/(\d+)/);
  return m ? Number(m[1]) : undefined;
};

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (!r?.courseHash || !r.title) continue;
    const weekday = WEEKDAY[r.weekdayText];
    const slot = {};
    if (weekday) slot.weekday = weekday;
    if (r.timeBegin) slot.startTime = r.timeBegin;
    if (r.timeEnd) slot.endTime = r.timeEnd;
    const statusRaw = (r.statusText ?? '').trim();
    const course = {
      _source: 'cc-shared-platform',
      _sourceRecordId: `${r.host}:${r.courseHash}`,
      _fetchedAt: fetchedAt,
      title: r.title.trim(),
      provider: {
        nameRaw: (r.schoolName || r.schoolLine || r.host).trim(),
        kind: 'community-college',
      },
      schedule: {
        recurrence: 'weekly',
        slots: Object.keys(slot).length ? [slot] : [],
      },
      enrollment: {
        status: STATUS[statusRaw] ?? 'unknown',
      },
      location: { addressPrecision: 'none' },
      sourceUrl: r.url,
    };
    if (r.startDate) course.schedule.startDate = r.startDate;
    if (r.timeOfDay) course.schedule.timeInfoRaw = r.timeOfDay; // box 版只有「下午」這種粗略時段
    if (statusRaw) course.enrollment.statusRaw = statusRaw;
    if (r.openFlag && r.openFlag !== statusRaw) course.enrollment.openFlagRaw = r.openFlag;
    const capacity = num(r.capacityText);
    if (capacity !== undefined) course.enrollment.capacity = capacity;
    if (r.teacher) course.teachers = [{ nameRaw: r.teacher.trim() }];
    if (r.courseCode) course.externalIds = { schoolCourseCode: r.courseCode };
    const term = parseTerm(r.termText);
    if (term) course.term = term;
    if (r.addressText) {
      // 來源混用「台」與「臺」，不統一的話同一個地址會被場館層拆成兩個場館
      const addressText = r.addressText.replace(/台/g, '臺').trim();
      course.location.venueNameRaw = addressText;
      course.location.addressPrecision = /\d+\s*號/.test(addressText) ? 'street' : 'venue-name-only';
      if (/\d+\s*號/.test(addressText)) course.location.address = addressText;
      const city = addressText.match(/^(..[市縣])/)?.[1];
      if (city) course.location.city = city;
      const district = addressText.match(/^..[市縣](..[區鄉鎮市])/)?.[1];
      if (district) course.location.district = district;
    } else if (r.areaText) {
      course.location.venueNameRaw = r.areaText;
      course.location.addressPrecision = 'venue-name-only';
    }
    if (r.note) course.description = r.note.trim();
    out.push(course);
  }
  return out;
}
