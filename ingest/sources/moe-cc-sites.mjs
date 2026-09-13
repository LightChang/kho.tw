// ingest/sources/moe-cc-sites.mjs
// 教育部「社區大學據點資訊」（data.gov.tw dataset 40181）。
// 12,859 列（108 學年起逐期），欄位：年度、期別、縣市、社區大學名稱、據點名稱、據點地址。
// 社大課程多半在分校、國中小、里活動中心上課，這份名錄是把「據點名」換成門牌的依據——
// geocode/build_tgos_input.py 已經在用它，把 1,474 筆只寫校名的地點換成了門牌。
import { fetchWithRetry, csvToObjects, runAsScript } from './_util.mjs';

const CSV = 'https://depart.moe.edu.tw/ed2400/Common/HitCount.ashx?p=C535150A0F617C6860CE01B098F7F2109789188FC445F71F5A68B1573A6310F8042DF60722082B0858719ECE87C7AD0715382C4021794C49AA4D5C2DF38858B39B7E17D2603DD16F955BC608E943D06B1CC821D950486A55C78E377A175B8AB6&type=FB01D469347C76A7&s=C9B2F32BA415989D';

export const meta = {
  id: 'moe-cc-sites',
  name: '社區大學據點資訊',
  org: '教育部終身教育司',
  homepage: 'https://data.gov.tw/dataset/40181',
  license: '政府資料開放授權條款-第1版（data.gov.tw dataset 40181 授權方式欄位）',
  updateFreq: '不定期更新（data.gov.tw dataset 40181 更新頻率欄位；實測 115 學年春季班已收錄）',
  format: 'csv',
  entity: 'venue',
  cadence: { kind: 'registry' },
  endpoints: [CSV],
  recordCount: 12859, // 實測 2026-09-11
  verifiedAt: '2026-09-11',
};

export async function fetchRaw() {
  const text = await (await fetchWithRetry(CSV)).text();
  return csvToObjects(text);
}

await runAsScript(import.meta.url, meta, fetchRaw);
