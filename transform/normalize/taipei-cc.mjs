// transform/normalize/taipei-cc.mjs
// 北市社大聯網 → L1 Course（見 transform/L1-FORMAT.md）
const SEASONS = [
  [/秋季班|第\s*2\s*期|第2學期/, 'autumn'],
  [/春季班|第\s*1\s*期|第1學期/, 'spring'],
  [/暑期班|暑假班/, 'summer'],
  [/寒假班/, 'winter'],
];
const STATUS = {
  招生中: 'open', 即將開課: 'open', 額滿: 'full', 開課中: 'running',
  已開課: 'running', 停招: 'cancelled', 停課: 'cancelled', 其它: 'unknown',
};
// cg（課程群組）→ provider.kind
const PROVIDER_KIND = {
  社區大學: 'community-college', 樂齡學堂: 'senior-center', 樂齡學習中心: 'senior-center',
  成人教育班: 'adult-education', 成人基本教育研習班: 'adult-education', 國中小進修部: 'school-continuing',
};

function parseTerm(raw) {
  if (!raw) return undefined;
  const year = Number((raw.match(/(\d{3})\s*年/) || [])[1]);
  const season = (SEASONS.find(([re]) => re.test(raw)) || [])[1];
  const term = { raw };
  if (year) term.year = year;
  if (season) term.season = season;
  return term;
}

// classTime 實測有 "16:15-19:15"、"1900-2100" 兩種寫法
function parseSlot(classTime, dayInWeekId) {
  const weekdays = (dayInWeekId ?? []).map(Number).filter((n) => n >= 1 && n <= 7);
  if (!classTime) return weekdays.map((weekday) => ({ weekday }));
  const hhmm = classTime.match(/(\d{1,2}):(\d{2})\s*[-~]\s*(\d{1,2}):(\d{2})/);
  const digits = classTime.match(/^(\d{2})(\d{2})\s*[-~]\s*(\d{2})(\d{2})$/);
  const m = hhmm || digits;
  if (!m) return weekdays.map((weekday) => ({ weekday }));
  const startTime = `${m[1].padStart(2, '0')}:${m[2]}`;
  const endTime = `${m[3].padStart(2, '0')}:${m[4]}`;
  return weekdays.length
    ? weekdays.map((weekday) => ({ weekday, startTime, endTime }))
    : [{ startTime, endTime }];
}

// 來源自己會出現打錯的年份（實測 4 筆：46123-01-01、46119-01-01、20263-04-01），
// 直接 slice 會把錯誤原封不動傳下去。只收合法 ISO 日期且年份在 2000–2100，
// 其餘略過這個欄位——不猜正確日期是什麼。
const dateOnly = (s) => {
  const m = String(s ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const year = Number(m[1]);
  if (year < 2000 || year > 2100) return undefined;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return Number.isNaN(new Date(`${iso}T00:00:00+08:00`).getTime()) ? undefined : iso;
};

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (!r?._id || !r.name) continue;
    const slots = parseSlot(r.classTime, r.dayInWeekId);
    const statusRaw = r.openStatus ?? '';
    const course = {
      _source: 'taipei-cc',
      _sourceRecordId: r._id,
      _fetchedAt: fetchedAt,
      title: r.name.trim(),
      provider: {
        nameRaw: (r.school ?? '').trim(),
        kind: PROVIDER_KIND[r.cg] ?? 'other',
      },
      schedule: {
        startDate: dateOnly(r.startDate),
        recurrence: slots.length > 1 ? 'twice-weekly' : 'weekly',
        slots,
      },
      enrollment: {
        status: STATUS[statusRaw] ?? 'unknown',
      },
      // address 欄位混了兩種東西：完整門牌（「臺北市士林區承德路四段190號」）與場地名
      //（「內湖高工」「戶外」）。有門牌的要標成 street 並填進 address，否則場館層會把
      // 同一個地址依「有沒有進 address」拆成兩個場館。
      location: (() => {
        const text = (r.address ?? '').trim();
        const isStreet = /\d+\s*號|[一二三四五六七八九十]+號/.test(text);
        const loc = {
          venueNameRaw: text || undefined,
          addressPrecision: isStreet ? 'street' : (text ? 'venue-name-only' : (r.district ? 'district' : 'city')),
          city: '臺北市',
          district: r.district || undefined,
        };
        if (isStreet) {
          loc.address = /^(臺北市|台北市)/.test(text) ? text : `臺北市${r.district ?? ''}${text}`;
        }
        return loc;
      })(),
    };
    if (r.code) course.externalIds = { schoolCourseCode: String(r.code) };
    if (r.classLink) course.sourceUrl = r.classLink;
    if (r.modifiedAt) course.sourceUpdatedAt = r.modifiedAt;
    if (r.requirement) course.description = r.requirement.trim();
    if (r.lcg) course.categoryRaw = r.lcg;
    if (r.teacher) course.teachers = [{ nameRaw: r.teacher.trim() }];
    if (r.endDate) course.schedule.endDate = dateOnly(r.endDate);
    if (r.semester) course.term = parseTerm(r.semester);
    if (statusRaw) course.enrollment.statusRaw = statusRaw;
    if (r.tuition != null && r.tuition !== '') {
      const n = Number(r.tuition);
      if (Number.isFinite(n)) {
        course.price = n;
        course.isFree = n === 0;
      } else {
        course.priceText = String(r.tuition);
      }
    }
    if (r.comment) course.enrollment.noteRaw = r.comment.trim();
    out.push(course);
  }
  return out;
}
