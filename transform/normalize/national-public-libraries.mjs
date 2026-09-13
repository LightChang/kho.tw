// transform/normalize/national-public-libraries.mjs
// 公共圖書館基本資料 → L1 Venue（見 transform/L1-FORMAT.md §4）
// 原始資料是**依縣市分組**：頂層 22 個縣市物件，每個底下一個「圖書館資訊」陣列。
//
// 這裡攤平成一館一筆（實測 2026-09-13：22 組共 616 館），理由有三個：
//   1. 下游接不上。transform/resolve-relations.mjs 的場館池是一筆 observation 一個場館，
//      它讀 payload 的 name／address／lat／lng 建門牌索引與名稱索引。不攤平的話 22 筆
//      會變成 22 個叫「基隆市」「臺北市」的假場館（name 是縣市、address 是空的），
//      616 個真正的館一個都進不了比對。
//   2. 變更軌跡會失準。observation 以 contentHash 判斷內容有沒有變，整個縣市一包的話，
//      任何一館改電話都會讓該縣市 100 多館一起被判成「有變」，lastChangedAt 失去意義。
//   3. 比對鍵本來就是館。resolve-relations 用地址與名稱對場館，這兩個值都在館這一層。
//
// 一館一筆之後，筆數從 22 變 616（扣掉測試資料為 615），這是預期的：ingest 層的
// recordCount 22 指的是分組數，L1 這層算的是場館數。
export const entityKind = 'venue';

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s || undefined;
};

// 地址實測 616 筆全部以縣市名開頭、沒有郵遞區號前綴，這裡仍保留防呆：
// 來源哪天改成「20241基隆市…」也不會把郵遞區號帶進門牌比對。
const stripZip = (s) => (s ? s.replace(/^\d{3,6}/, '').trim() : undefined);

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// 座標只收臺灣合理範圍內的值。實測有一筆經緯度寫反（見下方測試資料），
// 範圍檢查讓這種值變成「沒有座標」，而不是把館標到地圖外。
const inTaiwan = (lat, lng) => lat !== undefined && lng !== undefined
  && lat > 20 && lat < 27 && lng > 118 && lng < 123;

const decodeEntities = (s) => s
  .replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&');

// Intro 是各館自己寫的 HTML 簡介，去標籤後保留文字。內容裡的亂碼（例如「石?莊作」）
// 是來源本來就有的，不修，這一層只負責去標籤不負責改字。
const stripHtml = (s) => {
  if (!s) return undefined;
  const text = decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  return text || undefined;
};

export function normalize(records, { fetchedAt }) {
  const out = [];
  const seen = new Set();
  for (const group of records) {
    const city = clean(group?.['縣市']);
    const libs = Array.isArray(group?.['圖書館資訊']) ? group['圖書館資訊'] : [];
    if (!city) continue;
    for (const l of libs) {
      const name = clean(l?.Name);
      if (!name) continue;
      // 來源夾了一筆測試資料：名稱「測試圖書館」、簡介只有「測試」、官網空白，
      // 而且經緯度是顛倒的（Longitude 24.13／Latitude 120.68）。它不是真的館，
      // 放行的話網站會生出一個測試場館頁，所以直接排除。
      if (/測試/.test(name)) continue;
      // 館名實測 616 筆全域唯一，但仍加上縣市當前綴，避免不同縣市哪天出現同名分館。
      // 不把地址編進識別碼：來源修正門牌時，同一館要維持同一筆 observation。
      const key = `${city}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const lat = num(l?.Latitude);
      const lng = num(l?.Longitude);
      out.push({
        _source: 'national-public-libraries',
        _sourceRecordId: key,
        _fetchedAt: fetchedAt,
        name,
        kindRaw: '公共圖書館',
        city,
        // Area 就是行政區，實測 616 筆的 Area 字串都出現在自己的 Address 裡，兩者一致
        district: clean(l?.Area),
        address: stripZip(clean(l?.Address)),
        lat: inTaiwan(lat, lng) ? lat : undefined,
        lng: inTaiwan(lat, lng) ? lng : undefined,
        phone: clean(l?.TEL),
        // 各館官網，由館方自行維護（616 筆裡 1 筆真實資料為空白）
        website: clean(l?.URL),
        description: stripHtml(l?.Intro),
      });
    }
  }
  return out;
}
