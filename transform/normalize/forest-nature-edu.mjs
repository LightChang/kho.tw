// transform/normalize/forest-nature-edu.mjs
// 林業及自然保育署自然教育中心課程（data.gov.tw 70984）→ L1 Course
// 124 筆、7 個中心（奧萬大、八仙山、池南、東眼山、知本、羅東、雙流）。
//
// ⚠️ onAskEnd 多數是「活動30天前」「活動15天前」這種**規則字串**，不是日期。
//   實測 2026-09-13 的 11 種值裡有 6 種是規則、5 種是 ISO 日期。
//   規則字串不轉日期（沒有活動日可以扣，扣出來的都是編的），只有本來就是
//   YYYY-MM-DD 的才進 enrollment.closesAt；規則原文另存 closesRuleRaw
//   （沿用 L1 的 *Raw 慣例：正規化不了的原文留著，不丟、也不假裝是日期）。
//
// 來源沒有的：上課日期與時刻、時數、費用、名額、講師、地址與座標、期別。
//   這些細節要進 url 那頁才有，ingest 依 CONTRACT 只取原始資料，這一層不去展開。
// NAduType 只有代碼（6–11），來源與資料集說明都沒有附代碼對照表，
//   所以不填 categoryRaw——寧可不宣告，也不要把代碼當分類名印給使用者看。
// 中心所在縣市同理：欄位裡沒有，不從中心名去推，留給日後的場館對照表補。

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s || undefined;
};

const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '').trim()) ? String(v).trim() : undefined);

export function normalize(records, { fetchedAt }) {
  const today = fetchedAt.slice(0, 10);
  const out = [];
  for (const r of records) {
    const url = clean(r.url);
    const title = clean(r.NAduName);
    if (!url || !title) continue;
    // 課程頁網址的 id（AWD-A21501）就是來源自己的課程識別碼。
    // 實測 124 筆裡有 2 個 id 各出現兩次（DYS-C1504、BSS-D1508），
    // 依主檔慣例同 id 只留第一筆，所以 L1 會是 122 筆。
    const courseId = url.match(/[?&]id=([^&]+)/i)?.[1] ?? url;

    const opensAt = isoDate(r.onAskStartDay);
    const closesAt = isoDate(r.onAskEnd);
    const closesRuleRaw = closesAt ? undefined : clean(r.onAskEnd);

    // 報名截止只有規則字串時，狀態推不出來（不知道活動日）→ unknown，不寫 open。
    let status = 'unknown';
    if (closesAt && closesAt < today) status = 'closed';
    else if (opensAt && opensAt > today) status = 'upcoming';
    else if (opensAt && closesAt) status = 'open';

    const course = {
      _source: 'forest-nature-edu',
      _sourceRecordId: courseId,
      _fetchedAt: fetchedAt,
      title,
      provider: {
        nameRaw: clean(r.AduName) ?? '',
        kind: 'other', // 自然教育中心不屬於現有的 community-college／sports-center 等分類
      },
      schedule: {
        // 來源完全沒有上課日期，連頻率都沒有，所以只留空的 slots，不推 recurrence
        slots: [],
      },
      enrollment: {
        status,
        registerUrl: url,
      },
      location: {
        venueNameRaw: clean(r.AduName),
        addressPrecision: 'venue-name-only',
      },
      externalIds: { forestCourseCode: courseId },
      sourceUrl: url,
    };

    if (opensAt) course.enrollment.opensAt = opensAt;
    if (closesAt) course.enrollment.closesAt = closesAt;
    if (closesRuleRaw) course.enrollment.closesRuleRaw = closesRuleRaw;

    out.push(course);
  }
  return out;
}
