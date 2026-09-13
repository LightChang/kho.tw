// transform/normalize/moe-senior-centers.mjs
// 全國樂齡學習中心聯繫資料 → L1 Venue（見 transform/L1-FORMAT.md §5）
// 368 所，沒有座標，地址要走 geocode 流程；承辦單位多為國小、農會或社福團體。
export const entityKind = 'venue';

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s || undefined;
};
const stripZip = (s) => (s ? s.replace(/^\d{3,6}/, '').trim() : undefined);

export function normalize(records, { fetchedAt }) {
  const out = [];
  const seen = new Set();
  for (const r of records) {
    const name = clean(r['樂齡中心名稱']);
    const city = clean(r['縣市']);
    if (!name || !city) continue;
    const key = `${city}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      _source: 'moe-senior-centers',
      _sourceRecordId: key,
      _fetchedAt: fetchedAt,
      name,
      kindRaw: '樂齡學習中心',
      city,
      district: clean(r['鄉鎮市區名稱']),
      address: stripZip(clean(r['中心地址'])),
      ownerRaw: clean(r['承辦單位']),
      phone: clean(r['中心電話']),
      audienceRaw: '55歲以上',
    });
  }
  return out;
}
