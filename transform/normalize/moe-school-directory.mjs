// transform/normalize/moe-school-directory.mjs
// 教育部各級學校名錄 → L1 Venue（名錄類來源，entityKind = venue）
//
// 三個來源格式上的坑，都實測過：
//   縣市名稱 帶代碼前綴：「[01]新北市」→ 剝成「新北市」
//   地址     帶郵遞區號：「[234]新北市永和區福和路125巷20號」→ 剝成門牌
//   學年度   j1_new 含 104–115 共 12 個學年、u1_new 含 103–115 共 13 個學年，
//            同一所學校每個學年各出現一次（代碼 014501 的 12 列全是「市立板橋國中」）。
//            → 依「代碼」取最新學年那筆。用代碼而不是校名當識別：校名會改
//            （改制、更名），代碼不會；實測 115 學年 740 列的代碼不重複正好 740。
//            所以 8,875 列不是 8,875 所國中，是 740 所 × 12 個學年的歷史堆疊；
//            四檔收斂後全國 4,038 所（國小 2,609、國中 740、高中職 506、大專 139）。
//
// 不填 district：交給 transform/resolve-relations.mjs 的 districtOf() 用
// overrides/districts.json 統一反推，免得兩處各推一次、規則走樣。
// 不填 lat/lng：名錄沒有座標，門牌進 staged 後由 geocode 流程處理。
export const entityKind = 'venue';

const COUNTIES = [
  '臺北市', '新北市', '桃園市', '臺中市', '臺南市', '高雄市', '基隆市', '新竹市', '嘉義市',
  '新竹縣', '苗栗縣', '彰化縣', '南投縣', '雲林縣', '嘉義縣', '屏東縣', '宜蘭縣', '花蓮縣',
  '臺東縣', '澎湖縣', '金門縣', '連江縣',
];

// 去掉開頭的 [NN] 代碼或郵遞區號，並統一台→臺
const strip = (s) => String(s ?? '').replace(/台/g, '臺').replace(/^\[\d+\]/, '').trim();

const cityOf = (raw) => {
  const s = strip(raw);
  return COUNTIES.find((c) => s.startsWith(c)) ?? null;
};

export function normalize(records, { fetchedAt }) {
  // 依代碼取最新學年：同一所學校在 j1_new 裡最多出現三次（113／114／115）
  const latest = new Map();
  for (const r of records) {
    if (!r) continue;
    const code = String(r['代碼'] ?? '').trim();
    const name = strip(r['學校名稱']);
    if (!code || !name) continue;
    const key = `${r._file}:${code}`;
    const year = Number(r['學年度'] ?? 0);
    const prev = latest.get(key);
    if (!prev || year > prev.year) latest.set(key, { year, row: r });
  }

  const out = [];
  for (const [key, { row }] of latest) {
    const name = strip(row['學校名稱']);
    const address = strip(row['地址']);
    const city = cityOf(row['縣市名稱']) ?? cityOf(address);
    // 沒有門牌的名錄列沒有用處：它的唯一價值就是「校名 → 門牌」。
    // 中文數字門牌也算數（「新竹縣尖石鄉嘉樂村三鄰八十號」），全檔只有 1 所學校
    // 這樣寫，但只認阿拉伯數字就會把它整筆丟掉。段號與門牌的中文數字轉換
    // 由 resolve-relations.mjs 的 normAddress() 統一處理，這裡只判斷「有沒有號」。
    if (!address || !/[\d零〇一二三四五六七八九十百]+\s*號/.test(address)) continue;
    const venue = {
      _source: 'moe-school-directory',
      _sourceRecordId: key,
      _fetchedAt: fetchedAt,
      name,
      address,
      kindRaw: row._kind,
    };
    if (city) venue.city = city;
    const url = String(row['網址'] ?? '').trim();
    if (url.startsWith('http')) venue.sourceUrl = url;
    out.push(venue);
  }
  return out;
}
