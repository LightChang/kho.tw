// ingest/sources/taipei-cc.mjs
// 臺北市社區大學聯網（市民進修券系統）。免登入 JSON API，metadata.last 給總頁數。
// 涵蓋社區大學、樂齡學堂、樂齡學習中心、成人教育班、成人基本教育研習班、國中小進修部。
// openStatus 是本專案少數有報名狀態的來源之一（招生中／額滿／開課中／停招／即將開課）。
import { fetchWithRetry, runAsScript } from './_util.mjs';

const API = 'https://lle.tp.edu.tw/api/course';
const LIMIT = 5000; // 實測上限：limit=5000 有效，pageSize/size/perPage 都被忽略

export const meta = {
  id: 'taipei-cc',
  name: '臺北市社區大學聯網－課程',
  org: '臺北市政府教育局',
  homepage: 'https://lle.tp.edu.tw/',
  license: 'UNVERIFIED（站方未標示）',
  updateFreq: 'UNVERIFIED（實測 115 秋季班在開課前即有資料，為即時層）',
  format: 'json',
  entity: 'course',
  cadence: { kind: 'course-live', boostMonths: [1, 2, 7, 8] },
  endpoints: [`${API}?limit=${LIMIT}&page=1`],
  recordCount: 6045, // 實測 2026-09-11
  verifiedAt: '2026-09-11',
};

export async function fetchRaw() {
  const out = [];
  let page = 1;
  let last = 1;
  do {
    const res = await fetchWithRetry(`${API}?limit=${LIMIT}&page=${page}`);
    const body = await res.json();
    last = body?.metadata?.last ?? 1;
    out.push(...(body?.data ?? []));
    page += 1;
    if (page <= last) await new Promise((r) => setTimeout(r, 2000));
  } while (page <= last);
  return out;
}

await runAsScript(import.meta.url, meta, fetchRaw);
