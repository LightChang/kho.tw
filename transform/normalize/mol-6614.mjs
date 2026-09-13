// transform/normalize/mol-6614.mjs
// 勞動部「所屬分署自辦在職訓練課程資訊」（data.gov.tw 6614）→ L1 Course
// 118 筆在職者週末／夜間短期班，四個分署自辦，一筆一期別。
//
// ⚠️ 本來源**沒有任何名額欄位**（欄位只有辦理單位／開訓結訓／時段／時數／地點／報名起訖／
//   甄試日期／負擔費用／課名／期別／課程代碼／課程內容），所以 enrollment.capacity 與
//   available 一律不填。不要拿「訓練時數」或「期別」之類的數字去湊——首頁「快額滿」
//   只認 available，填錯就是假倒數。
//
// 原始頁面網址：來源沒有 url 欄位，但「課程代碼」就是在職訓練網的 OCID。
//   實測 2026-09-13：與 taiwanjobs 重疊的 2 筆（167900、171661），對方的 Url 正是
//   https://ojt.wda.gov.tw/ClassSearch/Detail?PlanType=2&OCID=<課程代碼>；
//   另外抓了兩個沒出現在 taiwanjobs 的代碼（167735、167736）驗證，兩頁都回 200
//   且內文含該筆課名，所以這個樣板是查證過的，不是套出來的。
//   PlanType=2 對應「分署自辦在職訓練」，正是本資料集的全部內容。
//
// 來源沒有的：名額、講師、課程分類、報名狀態文字、訓練地址（只有縣市）。
// 「甄試日期」L1 Course 沒有對應欄位，不另創鍵。

const OJT_DETAIL = 'https://ojt.wda.gov.tw/ClassSearch/Detail?PlanType=2&OCID=';

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s || undefined;
};

// 「20260905」→「2026-09-05」
function ymd(raw) {
  const m = String(raw ?? '').trim().match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

// 「學員負擔：1900;政府負擔：4527」→ 學員自付額
function priceOf(raw) {
  const m = String(raw ?? '').match(/學員負擔[：:]\s*([\d.]+)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

// 課程內容用「^」分段
function textOf(raw) {
  const s = String(raw ?? '')
    .replace(/&amp;/g, '&')
    .split('^')
    .map((seg) => seg.replace(/[\t\r]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return s || undefined;
}

// 只有報名起訖日，狀態用抓取日推
function statusOf(opensAt, closesAt, today) {
  if (closesAt && closesAt < today) return 'closed';
  if (opensAt && opensAt > today) return 'upcoming';
  if (opensAt && closesAt) return 'open';
  return 'unknown';
}

export function normalize(records, { fetchedAt }) {
  const today = fetchedAt.slice(0, 10);
  const out = [];
  for (const r of records) {
    const code = clean(r['課程代碼']);
    const title = clean(r['課程名稱']);
    if (!code || !title) continue;

    const opensAt = ymd(r['報名開始日']);
    const closesAt = ymd(r['報名結束日']);
    const url = `${OJT_DETAIL}${encodeURIComponent(code)}`;

    const course = {
      _source: 'mol-6614',
      _sourceRecordId: code,
      _fetchedAt: fetchedAt,
      title,
      provider: {
        // 辦理單位與 taiwanjobs 的 TrainingUnit 實測逐字相同（「勞動力發展署中彰投分署」）
        nameRaw: clean(r['辦理單位']) ?? '',
        kind: 'vocational',
        planRaw: '分署自辦在職訓練', // 資料集本身的名稱，也是 taiwanjobs 對應筆的 PlanName
      },
      schedule: {
        startDate: ymd(r['開訓日期']),
        endDate: ymd(r['結訓日期']),
        // 「假日」「晚上」只說時段不說頻率，週幾、幾點來源都沒有，不推 weekly
        recurrence: 'irregular',
        slots: [],
      },
      enrollment: {
        status: statusOf(opensAt, closesAt, today),
        registerUrl: url,
      },
      location: {
        // 訓練地點只到縣市（「桃園市」），沒有地址也沒有行政區
        city: clean(r['訓練地點']),
        addressPrecision: 'city',
        venueNameRaw: clean(r['辦理單位']),
      },
      // 課程代碼 ＝ 在職訓練網 OCID ＝ taiwanjobs 的 SourcePrimaryKey（重疊的 2 筆實測相同），
      // 鍵名沿用 taiwanjobs 那支的 externalIds.taiwanjobs
      externalIds: { taiwanjobs: code },
      sourceUrl: url,
    };

    const termRaw = clean(r['期別']);
    if (termRaw) {
      course.term = { raw: termRaw };
      const termNo = Number(termRaw);
      // 「03」→ 3。來源沒說期別是哪一年度的，所以不填 year。
      if (Number.isInteger(termNo) && termNo > 0) course.term.termNo = termNo;
    }
    const hours = Number(r['訓練時數']);
    if (Number.isFinite(hours) && hours > 0) course.schedule.hours = hours;
    const timeInfo = clean(r['訓練時段']);
    if (timeInfo) course.schedule.timeInfoRaw = timeInfo;
    if (opensAt) course.enrollment.opensAt = opensAt;
    if (closesAt) course.enrollment.closesAt = closesAt;
    const price = priceOf(r['負擔費用']);
    if (price !== undefined) {
      course.price = price;
      course.isFree = price === 0;
      const priceText = clean(r['負擔費用']);
      if (priceText) course.priceText = priceText; // 原文含政府負擔額
    }
    const description = textOf(r['課程內容']);
    if (description) course.description = description;

    out.push(course);
  }
  return out;
}
