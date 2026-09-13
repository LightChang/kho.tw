// transform/normalize/ntpc-cc.mjs
// 新北市社大聯合資訊網 → L1 Course（見 transform/L1-FORMAT.md）
// 列表層沒有費用、上課時刻與名額（那些在單課詳情頁），所以 L1 只帶得出日期、星期、狀態。
const WEEKDAY = { 星期一: 1, 星期二: 2, 星期三: 3, 星期四: 4, 星期五: 5, 星期六: 6, 星期日: 7 };
const STATUS = {
  招生中: 'open', 開課中: 'running', 已開課: 'running', 額滿: 'full',
  停課中: 'cancelled', 停招: 'cancelled', 已結束: 'closed',
};

// 新北的課名常見「【11/18開課】課名（六週）」前綴，保留原值，另存去前綴的版本供分群用
const stripPrefix = (t) => t.replace(/^【[^】]*】\s*/, '').trim();

// 列表沒有期別欄位，用開課日期推：2-6 月＝春季班、8-12 月＝秋季班、1 月＝寒假班、7 月＝暑期班
function termOf(startDate) {
  if (!startDate) return undefined;
  const [y, m] = startDate.split('-').map(Number);
  if (!y || !m) return undefined;
  const rocYear = y - 1911;
  if (m >= 2 && m <= 6) return { raw: `${rocYear}春`, year: rocYear, season: 'spring' };
  if (m === 7) return { raw: `${rocYear}暑`, year: rocYear, season: 'summer' };
  if (m >= 8 && m <= 12) return { raw: `${rocYear}秋`, year: rocYear, season: 'autumn' };
  return { raw: `${rocYear - 1}寒`, year: rocYear - 1, season: 'winter' };
}

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (!r?.classId || !r['課程名稱']) continue;
    const title = r['課程名稱'].trim();
    const startDate = r['開課日期'] || undefined;
    const weekday = WEEKDAY[r['授課星期']];
    const course = {
      _source: 'ntpc-cc',
      _sourceRecordId: String(r.classId),
      _fetchedAt: fetchedAt,
      title,
      provider: { nameRaw: (r['授課社大'] ?? '').trim(), kind: 'community-college' },
      schedule: {
        recurrence: 'weekly',
        slots: weekday ? [{ weekday }] : [],
      },
      enrollment: {
        status: STATUS[r['開課狀況']] ?? 'unknown',
        statusRaw: r['開課狀況'] ?? '',
      },
      location: {
        city: '新北市',
        addressPrecision: r['行政區'] ? 'district' : 'city',
      },
      sourceUrl: `https://cci.ntpc.edu.tw/cht/${r.detailPath}`,
    };
    if (startDate) course.schedule.startDate = startDate;
    if (r['行政區']) course.location.district = r['行政區'];
    if (r['課程類別']) course.categoryRaw = r['課程類別'];
    if (r['授課教師']) course.teachers = [{ nameRaw: r['授課教師'].trim() }];
    const term = termOf(startDate);
    if (term) course.term = term;
    const stripped = stripPrefix(title);
    if (stripped && stripped !== title) course.titleNormalized = stripped;
    out.push(course);
  }
  return out;
}
