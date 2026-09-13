// transform/normalize/moe-cc-sites.mjs
// 社區大學據點資訊 → L1 Venue（見 transform/L1-FORMAT.md §5）
// 一列是「某社大某學期的某個上課據點」，12,859 列裡 115 學年有 755 列、747 個不重複地址。
// 同一個據點會跨學期重複出現，收斂成一個場館，並記錄是哪些社大在用（多校共用同一所國中小很常見）。
export const entityKind = 'venue';

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s || undefined;
};
const stripZip = (s) => (s ? s.replace(/^\d{3,6}/, '').trim() : undefined);

export function normalize(records, { fetchedAt }) {
  const byKey = new Map();
  for (const r of records) {
    const name = clean(r['據點名稱']);
    const address = stripZip(clean(r['據點地址']));
    const city = clean(r['縣市別']);
    if (!name || !city) continue;
    const key = `${city}|${name}|${address ?? ''}`;
    const school = clean(r['社區大學名稱']);
    const year = clean(r['年度']);
    const prev = byKey.get(key);
    if (prev) {
      if (school && !prev.usedByRaw.includes(school)) prev.usedByRaw.push(school);
      if (year && (!prev.latestYear || year > prev.latestYear)) prev.latestYear = year;
      continue;
    }
    byKey.set(key, {
      _source: 'moe-cc-sites',
      _sourceRecordId: key,
      _fetchedAt: fetchedAt,
      name,
      kindRaw: '社區大學據點',
      city,
      address,
      usedByRaw: school ? [school] : [],
      latestYear: year,
    });
  }
  return [...byKey.values()].map((v) => ({ ...v, usedByRaw: v.usedByRaw.sort() }));
}
