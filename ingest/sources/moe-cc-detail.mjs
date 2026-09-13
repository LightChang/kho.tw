// ingest/sources/moe-cc-detail.mjs
// 教育部全國社大網「單筆課程詳情」端點（act_type=load_course_content）。
//
// 為什麼列表端點已經有 13,010 門課，還要另外接這支：
//   1. internal_course_code 只有詳情才給。cluster.mjs 的 1.0 規則
//      （校名＋期別＋校內課程代碼）對教育部這支從來沒成立過——列表端點根本沒這個欄位。
//      2026-09-13 抽 40 門北市社大的課實測，35 門的代碼與臺北市聯網的
//      schoolCourseCode 同值（87.5%），接上去這 2,912 門課就能跨來源合併。
//   2. course_intro 是課程簡介。全站 33,723 門課只有 8,423 門有描述（25%），
//      而列表端點一個字都沒有。
//
// 不必為了分類接它：course_cat_name 抽樣 60 筆只有「生活藝能 40／學術 12／社團 8」
// 三個值，那是社大的行政三分類、不是科目，對照到 overrides/taxonomy.json 只會全部是 null。
//
// **增量抓取**：course_id 取自 ingest/raw/moe-cc-courses.json，已經抓過的留在
// ingest/raw/moe-cc-detail.json 裡不重抓。首輪 13,010 筆、每筆間隔 250ms 約 54 分鐘，
// 所以每輪設上限 MAX_PER_RUN，分幾輪填完；之後每輪只抓新開的課。
// 間隔用 250ms 而不是 CONTRACT §3 的 2000ms：那個數字是排程對「不同來源打同一個網域」
// 的規定，這裡是同一支來源自己的分頁式逐筆讀取，2000ms 會讓首輪跑滿 7 小時、
// 佔著 run-pipeline.sh 的鎖。實測單筆 0.08s，250ms 已是站方回應時間的三倍。
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { postForm, parseJsonLoose, runAsScript } from './_util.mjs';

const AJAX = 'https://cc.moe.edu.tw/view/public_page/pub_load_ajax.php';
const RAW_DIR = path.resolve(import.meta.dirname, '..', 'raw');
const LIST_RAW = path.join(RAW_DIR, 'moe-cc-courses.json');
const SELF_RAW = path.join(RAW_DIR, 'moe-cc-detail.json');
const GAP_MS = 250;
const MAX_PER_RUN = 4000;

export const meta = {
  id: 'moe-cc-detail',
  name: '全國社區大學教育資訊網－課程詳情',
  org: '教育部終身教育司',
  homepage: 'https://cc.moe.edu.tw/',
  license: 'UNVERIFIED（站方未標示；robots.txt 為 User-Agent: * / Allow: /）',
  updateFreq: 'UNVERIFIED（隨列表端點的課程更新）',
  format: 'json',
  entity: 'course',
  cadence: { kind: 'course-archive', boostMonths: [3, 4, 9, 10] },
  endpoints: [AJAX],
  recordCount: 13010,
  verifiedAt: '2026-09-13',
};

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf-8'));
  } catch {
    return null;
  }
}

export async function fetchRaw() {
  const list = await readJson(LIST_RAW);
  if (!Array.isArray(list)) {
    throw new Error(`找不到 ${LIST_RAW}，請先跑 node ingest/sources/moe-cc-courses.mjs`);
  }
  const wanted = [...new Set(
    list.filter((r) => r?.course_id != null).map((r) => String(r.course_id)),
  )];
  const wantedSet = new Set(wanted);

  const cached = await readJson(SELF_RAW);
  const byId = new Map(
    (Array.isArray(cached) ? cached : [])
      .filter((r) => r?.course_id != null)
      .map((r) => [String(r.course_id), r]),
  );
  // 列表已經下架的課要從快取移除，否則它永遠留在這裡、observation 也永遠不會標 disappeared
  let dropped = 0;
  for (const id of [...byId.keys()]) {
    if (!wantedSet.has(id)) {
      byId.delete(id);
      dropped += 1;
    }
  }

  const missing = wanted.filter((id) => !byId.has(id));
  const batch = missing.slice(0, MAX_PER_RUN);
  let failed = 0;
  for (const id of batch) {
    try {
      const text = await postForm(AJAX, {
        user_id: '0',
        json_str: JSON.stringify({ act_type: 'load_course_content', course_id: Number(id) }),
      });
      const d = parseJsonLoose(text);
      if (d && d.course_id != null) byId.set(id, d);
      else failed += 1;
    } catch {
      // 單筆失敗不讓整支來源掛掉：這輪少一筆，下輪它還在 missing 裡會再試
      failed += 1;
    }
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  process.stderr.write(
    `[moe-cc-detail] 列表 ${wanted.length} 門｜快取命中 ${wanted.length - missing.length}`
    + `｜本輪新抓 ${batch.length - failed}（失敗 ${failed}）`
    + `｜還缺 ${Math.max(0, missing.length - batch.length + failed)}`
    + `｜清掉已下架 ${dropped}\n`,
  );
  return [...byId.values()].sort((a, b) => Number(a.course_id) - Number(b.course_id));
}

await runAsScript(import.meta.url, meta, fetchRaw);
