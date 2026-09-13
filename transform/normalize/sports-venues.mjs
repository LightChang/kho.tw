// transform/normalize/sports-venues.mjs
// 全國運動場館資訊 → L1 Venue（見 transform/L1-FORMAT.md §5）
// 原始檔一列是「一個場館的一項設施」，15,001 列其實是 9,861 個場館，所以要先依
// 縣市＋場館名稱＋地址收斂，把設施項目收成陣列。座標 15,001 列全有值。
export const entityKind = 'venue';

const num = (v) => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n !== 0 ? n : undefined;
};
const clean = (v) => {
  const s = String(v ?? '').trim();
  return s && s !== 'NULL' ? s : undefined;
};
// 地址欄長這樣：「[206]基隆市七堵區堵南街20號」
const stripZip = (s) => (s ? s.replace(/^\[\d+\]/, '').replace(/台/g, '臺').trim() : undefined);

// 來源的「縣市」欄放的是代碼（10002、63000），不是名稱。地址本身就以縣市開頭，
// 直接從地址取比維護一份代碼對照表可靠；地址缺漏時才退回代碼表。
const CITY_BY_CODE = {
  63000: '臺北市', 65000: '新北市', 68000: '桃園市', 66000: '臺中市', 67000: '臺南市',
  64000: '高雄市', 10017: '基隆市', 10018: '新竹市', 10020: '嘉義市', 10004: '新竹縣',
  10005: '苗栗縣', 10007: '彰化縣', 10008: '南投縣', 10009: '雲林縣', 10010: '嘉義縣',
  10013: '屏東縣', 10002: '宜蘭縣', 10015: '花蓮縣', 10014: '臺東縣', 10016: '澎湖縣',
  9020: '金門縣', 9007: '連江縣',
};
const COUNTIES = new Set(Object.values(CITY_BY_CODE));
// 地址可能寫「台中市」或以行政區開頭（「南投市中興路…」），所以要轉臺並用縣市白名單驗證，
// 不是合法縣市就退回代碼表。
const cityOf = (address, code) => {
  const guess = String(address ?? '').replace(/台/g, '臺').match(/^(..[市縣])/)?.[1];
  if (guess && COUNTIES.has(guess)) return guess;
  return CITY_BY_CODE[Number(code)];
};

export function normalize(records, { fetchedAt }) {
  const byVenue = new Map();
  for (const r of records) {
    const name = clean(r['場館名稱']);
    const address = stripZip(clean(r['地址']));
    const city = cityOf(address, r['縣市']);
    if (!name || !city) continue;
    const key = `${city}|${name}|${address ?? ''}`;
    const prev = byVenue.get(key);
    const facility = clean(r['場館分類']);
    if (prev) {
      if (facility && !prev.facilities.includes(facility)) prev.facilities.push(facility);
      continue;
    }
    const lat = num(r['緯度']);
    const lng = num(r['經度']);
    const venue = {
      _source: 'sports-venues',
      _sourceRecordId: key,
      _fetchedAt: fetchedAt,
      name,
      kindRaw: clean(r['場館隸屬機關屬性']),
      facilities: facility ? [facility] : [],
      city,
      district: clean(r['行政區']),
      address,
      // 座標是來源直接提供的 WGS84，不必走 geocode
      lat: lat !== undefined && lat > 20 && lat < 27 ? lat : undefined,
      lng: lng !== undefined && lng > 118 && lng < 123 ? lng : undefined,
      ownerRaw: clean(r['場館隸屬機關']),
      phone: clean(r['場館實際管理人電話']),
      // ⚠️ 官網欄位實測有失效值（泰山、淡水、蘆洲），只當提示不當事實
      websiteHint: clean(r['場館官方網站']),
      openingHoursRaw: clean(r['開放時間']),
      isSportsCenter: String(r['場館隸屬機關屬性'] ?? '').startsWith('國民運動中心'),
    };
    byVenue.set(key, venue);
  }
  return [...byVenue.values()].map((v) => ({ ...v, facilities: v.facilities.sort() }));
}
