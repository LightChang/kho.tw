// transform/normalize/mol-6060.mjs
// 勞動部「職業訓練課程資訊」（data.gov.tw 6060）→ L1 Course（見 transform/L1-FORMAT.md）
// 467 筆全是分署自辦職前訓練，欄位語意與 taiwanjobs 幾乎一對一，對照表就照那支寫。
//
// ⚠️「數量」不是招訓人數，是期別序號。實測 2026-09-13：
//   - 值域只有 1–8，213/467 是 1，當人數解讀不合理（900 小時的班不會只收 1 人）；
//   - 與 taiwanjobs 重疊的 64 筆，「數量」與對方課名裡的「第NN期」64/64 完全相同、0 筆不符；
//   - 同分署同課名的組依開訓日排序後，序號會在跨年時歸 1
//     （綜合銲接：2025-09=4 → 2026-01=1 → 03=2 → 07=3 → 09=4）。
//   所以它進 term（year 取開訓年份，跨年歸 1 就是這樣來的），不進 enrollment。
//   本來源**沒有任何名額欄位**：capacity 與 available 一律不填——填了首頁「快額滿」
//   就會出現假倒數，而 available 依 L1-FORMAT §2.3 是逐日變動的觀測值，這支給不出來。
//
// 其他來源沒有的：名額、講師、報名狀態文字（只有報名起訖日）、課程分類。
// 「甄試日期」「聯絡方式／手機／EMAIL」L1 Course 沒有對應欄位，不另創鍵。

// 「2025/11/18」→「2025-11-18」。來源月日沒有補零，補零後才排得動、也才比得了大小。
function ymd(raw) {
  const m = String(raw ?? '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : undefined;
}

// 「2025/11/18~2026/5/22」→ 兩個日期
function splitRange(raw) {
  const [a, b] = String(raw ?? '').split('~');
  return { start: ymd(a), end: ymd(b) };
}

// 「2025/08/18 00:00:00~2025/10/02 17:00:00」→ 帶時區的 ISO。
// 來源給到秒，就照實保留；只有日期的話不補假時刻。
function parseRegisterRange(raw) {
  const parts = String(raw ?? '').split('~');
  const one = (s) => {
    const d = ymd(s);
    if (!d) return undefined;
    const t = String(s).match(/(\d{2}):(\d{2}):(\d{2})/);
    return t ? `${d}T${t[1]}:${t[2]}:${t[3]}+08:00` : d;
  };
  return { opensAt: one(parts[0]), closesAt: one(parts[1]) };
}

// 「學員負擔：0.0000;政府負擔：22204.0000」→ 學員自付額。
// 實測 467 筆學員負擔全為 0（分署自辦職前訓練全額補助），但不寫死，來源哪天收費就跟著變。
function priceOf(raw) {
  const m = String(raw ?? '').match(/學員負擔[：:]\s*([\d.]+)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

// 來源用「^」當段落分隔、夾雜 tab 與 &amp;，轉成可讀文字。只做去殼，不改內容。
function textOf(raw) {
  const s = String(raw ?? '')
    .replace(/&amp;/g, '&')
    .split('^')
    .map((seg) => seg.replace(/[\t\r]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return s || undefined;
}

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s || undefined;
};

// 報名狀態來源只給起訖日，用抓取日推（同 taiwanjobs）。邊界日翻轉是真實變化。
function statusOf(opensAt, closesAt, today) {
  const open = opensAt?.slice(0, 10);
  const close = closesAt?.slice(0, 10);
  if (close && close < today) return 'closed';
  if (open && open > today) return 'upcoming';
  if (open && close) return 'open';
  return 'unknown';
}

export function normalize(records, { fetchedAt }) {
  const today = fetchedAt.slice(0, 10);
  const out = [];
  for (const r of records) {
    const id = clean(r['課程編號']);
    const title = clean(r['課程名稱']);
    if (!id || !title) continue;

    const { start, end } = splitRange(r['訓練期間']);
    const { opensAt, closesAt } = parseRegisterRange(r['報名期間']);
    const city = clean(r['訓練縣市']);
    const district = clean(r['訓練區域']);
    const street = clean(r['訓練地址']);
    // 訓練地址只有路名門牌（「凱旋四路105號」），縣市與行政區是分開的欄位，要接起來才 geocode 得動；
    // 來源哪天自己寫了縣市開頭就不再重複接。
    const address = street
      ? (street.startsWith(city ?? '') ? street : `${city ?? ''}${district ?? ''}${street}`)
      : undefined;
    const hasNumber = address ? /\d+\s*號|\d+\s*樓/.test(address) : false;

    const course = {
      _source: 'mol-6060',
      _sourceRecordId: id,
      _fetchedAt: fetchedAt,
      title,
      provider: {
        // 訓練單位名稱與 taiwanjobs 的 TrainingUnit 實測逐字相同，分群才對得上
        nameRaw: clean(r['訓練單位名稱']) ?? clean(r['分署']) ?? '',
        kind: 'vocational',
        operatorRaw: clean(r['單位名稱']), // 分署簡稱，對應 taiwanjobs 的 BranchName
      },
      schedule: {
        startDate: start,
        endDate: end,
        recurrence: 'irregular', // 職前訓練是連續密集班，不是每週一次
        slots: [],
      },
      enrollment: { status: statusOf(opensAt, closesAt, today) },
      location: {
        city,
        district,
        address: hasNumber ? address : undefined,
        addressPrecision: hasNumber ? 'street' : (district ? 'district' : 'city'),
        venueNameRaw: clean(r['訓練單位名稱']),
      },
      // 與 taiwanjobs 同一個 ID 空間：實測 64 筆的「課程編號」＝ 對方的 SourcePrimaryKey，
      // 且本來源的「網址」467/467 就是 …/Course/Detail?ID=<課程編號>。
      // 鍵名沿用 taiwanjobs 那支寫的 externalIds.taiwanjobs，兩邊才是同一個欄位。
      externalIds: { taiwanjobs: id },
    };

    const termNo = Number(r['數量']);
    if (Number.isInteger(termNo) && termNo > 0) {
      course.term = { raw: String(r['數量']).trim(), termNo };
      // 期別序號逐年歸 1，年份取開訓年（民國）
      const year = start ? Number(start.slice(0, 4)) - 1911 : undefined;
      if (Number.isFinite(year)) course.term.year = year;
    }
    const hours = Number(r['訓練時數']);
    if (Number.isFinite(hours) && hours > 0) course.schedule.hours = hours;
    const timeInfo = clean(r['訓練時段']);
    if (timeInfo) course.schedule.timeInfoRaw = timeInfo;
    if (opensAt) course.enrollment.opensAt = opensAt;
    if (closesAt) course.enrollment.closesAt = closesAt;
    const url = clean(r['網址']);
    if (url) {
      course.enrollment.registerUrl = url;
      course.sourceUrl = url;
    }
    const price = priceOf(r['經費']);
    if (price !== undefined) {
      course.price = price;
      course.isFree = price === 0;
      const priceText = clean(r['經費']);
      if (priceText) course.priceText = priceText; // 原文含政府負擔額，價格欄位只取學員自付
    }
    const description = [textOf(r['訓練目標']), textOf(r['課程內容'])].filter(Boolean).join('\n');
    if (description) course.description = description;

    out.push(course);
  }
  return out;
}
