// ingest/sources/moe-cc-courses.mjs
// 教育部「全國社區大學教育資訊網」課程查詢。
// 端點叫 aes，但公開頁不加密（前端 okb_key=""，見 utility/aes_ajax.js），POST 明文 JSON。
// ⚠️ 這是歷史層不是即時層：實測抽樣 30 門 115 春季課，29 門在開課後才建檔，
//    建檔日減開課日中位數 +50 天（見 probe/2026-09-11-sources.md §0）。
//    「現在可報名」要靠縣市聯網，這支負責全國 90 所的覆蓋與歷史。
import { postForm, parseJsonLoose, runAsScript } from './_util.mjs';

const AJAX = 'https://cc.moe.edu.tw/view/public_page/pub_load_ajax.php';
const SYSTEM_GROUP = 'AFTER1101';
// 抓最近四個期別（春／秋／暑／寒）。期別代碼 = 民國年 + 1春 2秋 3暑 4寒。
const QUARTERS = ['1151', '1152', '1153', '1154'];

export const meta = {
  id: 'moe-cc-courses',
  name: '全國社區大學教育資訊網－課程查詢',
  org: '教育部終身教育司',
  homepage: 'https://cc.moe.edu.tw/',
  license: 'UNVERIFIED（站方未標示；robots.txt 為 User-Agent: * / Allow: /）',
  updateFreq: 'UNVERIFIED（各社大自行上傳，實測落後開課日中位數 50 天）',
  format: 'json',
  entity: 'course',
  cadence: { kind: 'course-archive', boostMonths: [3, 4, 9, 10] },
  endpoints: [AJAX],
  recordCount: 13011, // 實測 2026-09-13（2026-09-11 首測為 12370，各社大陸續補登）
  verifiedAt: '2026-09-13',
};

async function loadQuarter(quarter) {
  const text = await postForm(AJAX, {
    user_id: '0',
    aoData: '[]',
    json_str_aes: JSON.stringify({
      act_type: 'load_course_list',
      region_id: '-1', school_id: '-1', quarter,
      weekday: '-1', run_status: '-1', price_type: '-1', teach_status: '-1',
      system_group: SYSTEM_GROUP, keyword: '',
      s_echo: 1, i_display_start: 0, i_display_length: 20000,
    }),
  });
  const rows = parseJsonLoose(text);
  // 最後一列是 DataTables 的 {s_echo, i_total_records, ...} 統計列，不是課程
  return Array.isArray(rows) ? rows.filter((r) => r && r.course_id != null) : [];
}

// 社大名錄與期別清單，正規化時要用它補縣市
export async function fetchSchools() {
  const text = await postForm(AJAX, {
    user_id: '0',
    json_str: JSON.stringify({ act_type: 'load_school_quarter_list', system_group: SYSTEM_GROUP }),
  });
  const d = parseJsonLoose(text);
  return Array.isArray(d) ? d[0] : d;
}

export async function fetchRaw() {
  const { school_list = [], region_list = [], quarter_list = [] } = (await fetchSchools()) || {};
  const out = [];
  for (const quarter of QUARTERS) {
    const rows = await loadQuarter(quarter);
    for (const r of rows) out.push({ ...r, _quarter: quarter });
    await new Promise((r) => setTimeout(r, 2000)); // 同網域兩次請求間隔
  }
  // 名錄跟著課程一起存，正規化層不必再打一次
  return [{ _kind: 'meta', school_list, region_list, quarter_list }, ...out];
}

await runAsScript(import.meta.url, meta, fetchRaw);
