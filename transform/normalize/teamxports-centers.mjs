// transform/normalize/teamxports-centers.mjs
// 全越運動 XPORTS 報名系統（運動中心期課）→ L1 Course（見 transform/L1-FORMAT.md）
//
// 名額：來源同時給 capacityMax、signedUpCount 與 avaliableCount（剩餘），三者實測一致，
// 所以 capacity 與 available 都填（CONTRACT §5）。
// 狀態：照前端 getButtonLabel() 的判斷順序——剩餘 0 → 額滿；再看 enrollmentStatus。
// 教師：不收。前端把姓名遮成「林●皓」，來源自己不公開全名（見 ingest 檔頭）。

const WEEKDAY = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7 };
const STATUS = {
  0: ['open', '我要報名'],
  1: ['upcoming', '報名時間未到'],
  2: ['closed', '報名時間已過'],
  3: ['running', '課程已開始'],
  4: ['unknown', '目前僅限原班學員續報'],
};

const hhmm = (t) => (/^\d{2}:\d{2}/.test(t ?? '') ? t.slice(0, 5) : undefined);
const date = (t) => (/^\d{4}-\d{2}-\d{2}/.test(t ?? '') ? t.slice(0, 10) : undefined);

// 運動中心是雙月期別，期別由開課日推，和 xuanen-centers 同一套（1–2 月＝第 1 期…）
function termOf(startDate) {
  if (!startDate) return undefined;
  const [y, m] = startDate.split('-').map(Number);
  const termNo = Math.floor((m - 1) / 2) + 1;
  return { raw: `${y - 1911}${String(termNo).padStart(2, '0')}`, year: y - 1911, termNo };
}

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    if (r?.id == null || !r._siteId || !r.title) continue;
    const venue = String(r._siteTitle ?? '').trim();
    const address = String(r._siteAddress ?? '').replace(/^\d{3,6}/, '').trim();
    const slots = (r.week ?? []).filter((w) => WEEKDAY[w]).map((w) => {
      const slot = { weekday: WEEKDAY[w] };
      if (hhmm(r.startTime)) slot.startTime = hhmm(r.startTime);
      if (hhmm(r.endTime)) slot.endTime = hhmm(r.endTime);
      return slot;
    });
    const [status, statusRaw] = r.avaliableCount === 0
      ? ['full', '已額滿']
      : (STATUS[r.enrollmentStatus] ?? ['unknown', String(r.enrollmentStatus ?? '')]);
    const course = {
      _source: 'teamxports-centers',
      _sourceRecordId: `${r._siteId}:${r.id}`,
      _fetchedAt: fetchedAt,
      title: String(r.title).trim(),
      provider: { nameRaw: venue, kind: 'sports-center', operatorRaw: '全越運動' },
      schedule: {
        startDate: date(r.startDate),
        endDate: date(r.endDate),
        recurrence: 'weekly',
        slots,
      },
      enrollment: { status, statusRaw },
      location: {
        venueNameRaw: `${venue} ${(r.courtTitles ?? [])[0] ?? ''}`.trim(),
        addressPrecision: 'venue-name-only',
      },
    };
    if (r.number) course.externalIds = { centerCourseCode: String(r.number).trim() };
    if (r._categoryName) course.categoryRaw = r._categoryName;
    const skipped = (r.excludedDate ?? []).map((x) => `${x.date ?? ''}${x.note ? ` ${x.note}` : ''}`.trim()).filter(Boolean);
    if (skipped.length) course.schedule.timeInfoRaw = `停課：${skipped.join('、')}`;
    // 報名起訖原文是不帶時區的台北時間（2026-10-31T00:00:00），只補時區、不改時刻
    const local = (t) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(t ?? '') ? `${t}+08:00` : undefined);
    if (local(r.regStartDate)) course.enrollment.opensAt = local(r.regStartDate);
    if (local(r.regEndDate)) course.enrollment.closesAt = local(r.regEndDate);
    if (Number.isFinite(r.capacityMax) && r.capacityMax > 0) course.enrollment.capacity = r.capacityMax;
    if (Number.isFinite(r.avaliableCount)) course.enrollment.available = r.avaliableCount;
    if (Number.isFinite(r.price) && r.price > 0) course.price = r.price;
    // 館址只拿來定縣市與行政區，不當門牌給場館層。門牌會先對名錄的門牌索引：
    // 天母運動訓練館（北護爾雅樓二樓）的門牌對到名錄的「北護水療中心」，課就被掛到別的場館名下。
    // 各館改用館名對名錄（三峽、鶯歌、信義、豐原都對得到，座標也來自名錄）。
    // 只認「區」：[區鄉鎮市] 放一起時非貪婪比對會把「前鎮區」切成「前鎮」（docs/pipeline.md §4）
    const place = address.match(/^([臺台][北中南東]市|..[市縣])(.{1,3}?區)/);
    if (place) {
      course.location.city = place[1].replace(/^台/, '臺');
      course.location.district = place[2];
      course.location.addressPrecision = 'district';
    }
    const term = termOf(course.schedule.startDate);
    if (term) course.term = term;
    if (r._siteHost) course.sourceUrl = `https://${String(r._siteHost).toLowerCase()}/course`;
    out.push(course);
  }
  return out;
}
