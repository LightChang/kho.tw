// ingest/sources/moe-school-directory.mjs
// 教育部各級學校名錄（國小／國中／高中職／大專）。entity 是 venue，不是 course。
//
// 為什麼要接：社大與樂齡的課大量借用學校場地，而來源的地點欄常常只寫校名
// （「內湖高工」552 門、「市立大里高中」165 門、「豐東國中」101 門）。
// 這種記錄在管線裡走 resolve-relations 的 derived-name 分支，address 是 null、
// 永遠拿不到座標——全站缺座標的 13,706 門課裡，derived-name 佔 4,871 門。
// 把學校名錄接成正規的 venue 名錄之後：
//   1. loadRegistry() 會用 byName 索引它，lookupName('內湖高工') 直接對到門牌
//   2. 門牌進了 data/staged/，geocode/build_tgos_input.py 下一批自然會送 TGOS
// 兩邊一次解決。在此之前只有 build_tgos_input.py 自己上網抓這份名錄，
// 管線這一側看不到它（那支腳本的檔頭註解寫明了這個限制）。
//
// 四個檔的欄位一致：學年度／代碼／學校名稱／公私立／縣市名稱／地址／電話／網址。
// j1_new 與 u1_new 含 113–115 三個學年，同一所學校會出現多次，所以要依代碼取最新學年。
import { csvToObjects, fetchWithRetry, runAsScript } from './_util.mjs';

// 部分教育部網域（stats.moe.gov.tw）的憑證缺 Subject Key Identifier，
// Node 的預設驗證目前接受，若日後被拒再處理；這裡不關閉任何驗證。
const FILES = [
  { kind: '國小', url: 'https://stats.moe.gov.tw/files/school/115/e1_new.csv' },
  { kind: '國中', url: 'https://stats.moe.gov.tw/files/opendata/j1_new.csv' },
  { kind: '高中職', url: 'https://stats.moe.gov.tw/files/school/115/high.csv' },
  { kind: '大專', url: 'https://stats.moe.gov.tw/files/opendata/u1_new.csv' },
];

export const meta = {
  id: 'moe-school-directory',
  name: '教育部各級學校名錄（國小／國中／高中職／大專）',
  org: '教育部統計處',
  homepage: 'https://stats.moe.gov.tw/',
  license: 'UNVERIFIED（政府統計公開資料，站方未標示授權條款）',
  updateFreq: '每學年',
  format: 'csv',
  entity: 'venue',
  cadence: { kind: 'registry' },
  endpoints: FILES.map((f) => f.url),
  // 原始列數 2609 + 8875 + 506 + 1946。注意 j1_new 與 u1_new 是多學年堆疊
  //（同一所學校每個學年各一列），收斂到最新學年後全國實際 4,038 所。
  recordCount: 13936,
  verifiedAt: '2026-09-13',
};

export async function fetchRaw() {
  const out = [];
  for (const { kind, url } of FILES) {
    const res = await fetchWithRetry(url);
    // 這批檔實測是 UTF-8 with BOM；csvToObjects 會自己去 BOM
    const rows = csvToObjects(await res.text());
    for (const r of rows) out.push({ ...r, _kind: kind, _file: url.split('/').pop() });
    process.stderr.write(`[moe-school-directory] ${url.split('/').pop()} ${rows.length} 列\n`);
    await new Promise((r) => setTimeout(r, 2000)); // 同網域兩次請求間隔
  }
  return out;
}

await runAsScript(import.meta.url, meta, fetchRaw);
