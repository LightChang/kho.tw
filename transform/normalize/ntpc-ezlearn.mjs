// transform/normalize/ntpc-ezlearn.mjs
// 新北市數位樂學網 → L1 Course（見 transform/L1-FORMAT.md）
// 本專案唯一有完整報名視窗（起訖含時刻）的樂齡來源，報名狀態由視窗與抓取日推導。
const KIND = [
  [/樂齡/, 'senior-center'],
  [/松年/, 'senior-center'],
  [/婦女/, 'women-center'],
  [/社區大學|社大/, 'community-college'],
];

// "2026-08-03 09:00~2026-08-07 12:00"
function parseRange(raw) {
  const m = String(raw ?? '').match(/([\d-]{10})\s*([\d:]{5})?\s*[~－-]\s*([\d-]{10})\s*([\d:]{5})?/);
  if (!m) return {};
  const iso = (d, t) => `${d}T${t ?? '00:00'}:00+08:00`;
  return { opensAt: iso(m[1], m[2]), closesAt: iso(m[3], m[4]) };
}

const firstDate = (raw) => String(raw ?? '').match(/\d{4}-\d{2}-\d{2}/)?.[0];

export function normalize(records, { fetchedAt }) {
  const today = fetchedAt.slice(0, 10);
  const out = [];
  for (const r of records) {
    if (!r?.courseId || !r.title) continue;
    const provider = (r.providerText ?? '').trim();
    const { opensAt, closesAt } = parseRange(r.registerRange);
    let status = 'unknown';
    if (closesAt && closesAt.slice(0, 10) < today) status = 'closed';
    else if (opensAt && opensAt.slice(0, 10) > today) status = 'upcoming';
    else if (opensAt && closesAt) status = 'open';
    const course = {
      _source: 'ntpc-ezlearn',
      _sourceRecordId: String(r.courseId),
      _fetchedAt: fetchedAt,
      title: r.title.trim(),
      provider: {
        nameRaw: provider,
        kind: (KIND.find(([re]) => re.test(provider)) || [null, 'other'])[1],
      },
      schedule: { recurrence: 'weekly', slots: [] },
      enrollment: { status },
      location: {
        city: '新北市',
        addressPrecision: (r.areaText ?? '').trim() ? 'district' : 'city',
      },
      sourceUrl: `https://ezlearn.ntpc.gov.tw/courses/detail/${r.courseId}`,
    };
    const start = firstDate(r.startDateText);
    if (start) course.schedule.startDate = start;
    if ((r.areaText ?? '').trim()) course.location.district = r.areaText.trim();
    if ((r.categoryText ?? '').trim()) course.categoryRaw = r.categoryText.trim();
    if (opensAt) course.enrollment.opensAt = opensAt;
    if (closesAt) course.enrollment.closesAt = closesAt;
    const capacity = Number(String(r.capacityText ?? '').match(/(\d+)/)?.[1]);
    if (Number.isFinite(capacity)) course.enrollment.capacity = capacity;
    out.push(course);
  }
  return out;
}
