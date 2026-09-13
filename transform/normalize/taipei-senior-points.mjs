// transform/normalize/taipei-senior-points.mjs
// 臺北市銀髮族據點課程資訊 → L1 Course（見 transform/L1-FORMAT.md）
// 420 筆，110 個據點。來源只有七個欄位：課程名稱、開課起始／結束日期、地點、電話、
// 人數、授課老師——沒有費用、沒有報名視窗、沒有上課時刻、沒有課程網址，這些一律不寫。
//
// 三件刻意不做的事：
//   1. 不推報名狀態。來源沒有任何報名欄位，「人數」是該課收容上限不是即時餘額
//      （見 ingest/sources/taipei-senior-points.mjs）。用開課結束日已過去推 closed 是拿
//      上課期間冒充報名期間，屬於臆測，所以 status 一律 unknown。
//   2. 不解析上課時刻。420 筆裡只有 18 筆把星期寫進課名（「週三上午ㄧ體適能運動課程」），
//      而且只有「上午」沒有時刻，湊不出 slots.startTime，寧可留空。
//      recurrence 也同理：來源沒說是每週還是不定期，整個 key 省略。
//   3. 不編地址。地點欄只有據點名稱（「財團法人基督教拿撒勒人會(關渡據點)」），
//      沒有地址也沒有座標，所以 address 不寫、addressPrecision 記為 venue-name-only，
//      座標交給後續 geocode 流程。
//
// 場館怎麼接上：provider.kind 設 senior-center，transform/resolve-relations.mjs 會把這類
// 「場館自營」的來源用 provider.nameRaw 當場館名去比對名錄（moe-senior-centers 等），
// 所以 provider.nameRaw 要放乾淨的據點名，不要接教室或課名。

// 民國年：只從開課起始日期換算，不生造「○○年度秋季班」這種來源沒有的期別原文。
// 因此只有 term.year，沒有 term.raw／term.season。
const rocYear = (date) => {
  const y = Number(String(date ?? '').slice(0, 4));
  return Number.isFinite(y) && y > 1911 ? y - 1911 : undefined;
};

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s || undefined;
};

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '').trim());

// 臺北市 12 個行政區，只在據點名稱以「臺北市○○區」開頭時才採用。
// 不能只看名稱裡有沒有出現區名：「財團法人新北市基督教新希望教會(中山五常)」是
// 在新北市立案、於臺北市中山區服務的據點，從名稱中段抓「中山」會抓錯。
const TAIPEI_DISTRICTS = new Set(['中正區', '大同區', '中山區', '松山區', '大安區', '萬華區',
  '信義區', '士林區', '北投區', '內湖區', '南港區', '文山區']);

const districtOf = (placeName) => {
  const d = String(placeName ?? '').match(/^臺北市(..區)/)?.[1];
  return d && TAIPEI_DISTRICTS.has(d) ? d : undefined;
};

export function normalize(records, { fetchedAt }) {
  const out = [];
  for (const r of records) {
    const title = clean(r['課程名稱']);
    const place = clean(r['地點']);
    if (!title || !place) continue;
    const startDate = isDate(r['開課起始日期']) ? r['開課起始日期'].trim() : undefined;
    const endDate = isDate(r['開課結束日期']) ? r['開課結束日期'].trim() : undefined;

    const course = {
      _source: 'taipei-senior-points',
      // 來源沒有課程代碼。實測 2026-09-13：地點＋課名＋起訖日這組鍵 420 筆全不重複
      // （同一據點的同名課會用「預防及延緩失能-3」這種編號或不同期間區隔）。
      _sourceRecordId: [place, title, startDate ?? '', endDate ?? ''].join('|'),
      _fetchedAt: fetchedAt,
      title,
      // 資料集名稱就是「銀髮族據點課程」，這是整份資料的對象，不是逐筆欄位推出來的
      audienceRaw: '銀髮族',
      provider: {
        nameRaw: place,
        kind: 'senior-center',
      },
      schedule: {
        startDate,
        endDate,
        slots: [], // 來源沒有星期與時刻，見檔頭第 2 點
      },
      enrollment: {
        status: 'unknown', // 來源沒有報名欄位，見檔頭第 1 點
      },
      location: {
        venueNameRaw: place,
        city: '臺北市', // 臺北市政府社會局的市內據點名錄，全部在臺北市
        district: districtOf(place),
        addressPrecision: 'venue-name-only',
      },
    };

    // 電話是據點的聯絡電話，來源沒給報名網址，這是唯一的報名管道線索
    const phone = clean(r['電話']);
    if (phone) course.provider.phoneRaw = phone;

    const teacher = clean(r['授課老師']); // 420 筆裡 16 筆空白
    if (teacher) course.teachers = [{ nameRaw: teacher }];

    const year = rocYear(startDate);
    if (year) course.term = { year };

    // 「人數」是收容人數上限 → capacity。available（即時餘額）來源沒有，不寫。
    const capacity = Number(String(r['人數'] ?? '').trim());
    if (Number.isInteger(capacity) && capacity > 0) course.enrollment.capacity = capacity;

    out.push(course);
  }
  return out;
}
