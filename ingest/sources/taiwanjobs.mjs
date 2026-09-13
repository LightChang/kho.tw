// ingest/sources/taiwanjobs.mjs
// 台灣就業通「職訓課程查詢」的後端 API（Next.js 前端 /course/conditions 呼叫的同一支）。
// 免登入；Authorization 標頭在未登入時是 undefined，照樣回資料。
// 它匯總了開放資料 6060／6614 之外的產業人才投資方案（實測 1827 門，佔七成六）。
import { postForm, parseJsonLoose, runAsScript } from './_util.mjs';

const API = 'https://course.taiwanjobs.gov.tw/api/Course/paging';
const PAGE = 200;
// SourceType 對照取自 /course/search-training 的 __NEXT_DATA__ .SourceTypeList
export const SOURCE_TYPES = {
  1: '職前訓練', 2: '分署自辦在職訓練', 3: '青年專班', 4: '產業新尖兵計畫',
  5: '其他政府單位課程', 6: '產業人才投資方案', 7: '區域產業據點',
};

export const meta = {
  id: 'taiwanjobs',
  name: '台灣就業通－職訓課程查詢',
  org: '勞動部勞動力發展署',
  homepage: 'https://course.taiwanjobs.gov.tw/',
  license: 'UNVERIFIED（站方未標示；頁面 meta robots 為 all）',
  updateFreq: 'UNVERIFIED（每筆有 UpdateTime，實測當日即有更新）',
  format: 'json',
  entity: 'course',
  cadence: { kind: 'course-live' },
  endpoints: [API],
  recordCount: 2396, // 實測 2026-09-13，TrainingPeriod=1（近期課程）全類別（09-11 為 2397，來源自然增減）
  verifiedAt: '2026-09-13',
};

async function pageThrough(sourceType) {
  const out = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const text = await postForm(API, {
      Limit: String(PAGE), Offset: String(offset),
      SourceType: String(sourceType), TrainingPeriod: '1', Search: '',
    });
    const body = parseJsonLoose(text);
    total = body?.total ?? 0;
    const rows = body?.rows ?? [];
    if (rows.length === 0) break;
    for (const r of rows) out.push({ ...r, _sourceType: sourceType });
    offset += rows.length;
    if (offset < total) await new Promise((r) => setTimeout(r, 2000));
  }
  return out;
}

export async function fetchRaw() {
  const out = [];
  for (const t of Object.keys(SOURCE_TYPES)) {
    out.push(...(await pageThrough(Number(t))));
    await new Promise((r) => setTimeout(r, 2000));
  }
  return out;
}

await runAsScript(import.meta.url, meta, fetchRaw);
