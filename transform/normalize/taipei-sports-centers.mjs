// transform/normalize/taipei-sports-centers.mjs
// 臺北市各區運動中心 → L1 Venue（見 transform/L1-FORMAT.md §4）
// 12 座市民運動中心，一列就是一座場館，沒有重複、沒有設施拆列，所以不必像
// sports-venues 那樣收斂——那支是「一個場館的一項設施」一列。
// 12 列的七個欄位實測全部有值（2026-09-13），沒有空值要處理。
//
// 這支和 sports-venues 會指到同樣這 12 座場館，差別在官網欄位：sports-venues 的
// 官網實測有失效值（泰山、淡水、蘆洲），北市這 12 座依 ingest/CONTRACT.md §4 以本檔為準，
// 所以這裡用 website 而不是 sports-venues 的 websiteHint（後者的語意是「只當提示」）。
export const entityKind = 'venue';

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s || undefined;
};

const num = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) ? n : undefined;
};

// 座標只收臺灣本島合理範圍內的值，超出就當沒有——寧可讓 geocode 去補，
// 也不要把經緯度顛倒或打錯的點畫到地圖上。
const inTaiwan = (lat, lng) => lat !== undefined && lng !== undefined
  && lat > 20 && lat < 27 && lng > 118 && lng < 123;

export function normalize(records, { fetchedAt }) {
  const out = [];
  const seen = new Set();
  for (const r of records) {
    const name = clean(r['名稱']);
    const address = clean(r['地址']);
    if (!name) continue;
    // 名稱 12 座各不相同，拿它當識別碼；不把地址編進去，這樣來源哪天修正門牌
    // 時同一座中心仍是同一筆 observation，不會變成「舊的消失、新的出現」。
    if (seen.has(name)) continue;
    seen.add(name);
    const lat = num(r['緯度']);
    const lng = num(r['經度']);
    out.push({
      _source: 'taipei-sports-centers',
      _sourceRecordId: name,
      _fetchedAt: fetchedAt,
      name,
      kindRaw: '國民運動中心',
      city: '臺北市', // 本資料集就是臺北市政府體育局的市內名錄，12 筆地址也都以臺北市開頭
      // 行政區來源沒有獨立欄位，從地址開頭取（實測 12 筆全部是「臺北市○○區…」）
      district: address?.match(/^臺北市(..區)/)?.[1],
      address,
      lat: inTaiwan(lat, lng) ? lat : undefined,
      lng: inTaiwan(lat, lng) ? lng : undefined,
      phone: clean(r['電話']),
      website: clean(r['網址']),
      isSportsCenter: true,
    });
  }
  return out;
}
