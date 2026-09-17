// src/pages/llms-full.txt.js
// /llms-full.txt：讓 AI 助理一次讀到可直接引用的內容，不必逐頁爬。
// 與 /llms.txt 的分工：llms.txt 是目錄（站台簡介＋入口清單），這裡是「全文」。
//
// 本站 32,000+ 門課不可能全部收錄，這裡的取樣規則寫在檔頭：
//   1. 聚合統計（依機構類型／主題分類／縣市）——這是彙總數字，不是逐頁內容，收錄全部
//   2. 代表性課程全文——挑「跨來源合併」與「剩餘名額即時揭露」這兩項本站的差異化事實各挑幾筆，
//      展示欄位深度與來源／日期，不是隨機或窮舉
// 完整資料一律指向 sitemap 與站內搜尋，不在這裡假裝收全。
//
// 內容全部取自 getData()（build 當下讀 data/ 的真實資料），不手寫任何數字或課程內容。
import { getData, fmt, WEEKDAY_LABEL, STATUS_LABEL } from '../lib/data.mjs';
import { SITE_URL, courseUrl, describe } from '../../site/jsonld.mjs';

const kindLabelMap = (home) => Object.fromEntries(home.types.map((k) => [k.kind, k.label]));

function courseBlock(c, courseUrlFn, kindLabels) {
  const kindLabel = kindLabels[c.provider?.kind] ?? c.provider?.kind;
  const when = (c.schedule?.slots ?? [])
    .map((s) => `${WEEKDAY_LABEL[s.weekday] ?? ''} ${s.startTime ?? ''}${s.endTime ? `–${s.endTime}` : ''}`.trim())
    .filter(Boolean).join('、');
  const period = [c.schedule?.startDate, c.schedule?.endDate].filter(Boolean).join(' – ');
  const price = c.isFree ? '免費' : (c.price !== undefined ? `${fmt(c.price)} 元` : (c.priceText ?? '未提供'));
  const available = Number.isFinite(c.enrollment?.available) && c.enrollment?.capacity !== undefined
    ? `尚餘 ${c.enrollment.available}／${c.enrollment.capacity} 名額`
    : '';
  const lines = [
    `### ${c.title}`,
    `網址：${courseUrlFn(c)}`,
    `開課單位：${c.provider?.nameRaw ?? '未提供'}${kindLabel ? `（${kindLabel}）` : ''}`,
    `地點：${c.venue?.name ?? '未提供'}${c.venue?.city ? `，${c.venue.city}${c.venue.district ?? ''}` : ''}`,
    `分類：${c.category ?? '未分類'}${c.categoryFrom === 'title' ? '（依課名判斷，非來源標示）' : ''}`,
    when ? `上課時間：${when}` : '',
    period ? `期間：${period}` : '',
    `費用：${price}`,
    available ? `名額：${available}` : '',
    `報名狀態：${STATUS_LABEL[c.enrollment?.status] ?? c.enrollment?.status ?? '未知'}`,
    '',
    (c.description?.trim() || describe(c)),
    '',
    '資料來源：',
    ...(c.sources ?? []).map((s) => `- ${s.id}：${s.url ?? '（無連結）'}（最後確認 ${s.lastVerifiedAt ?? '未知'}；提供欄位：${(s.provides ?? []).join('、')}）`),
  ].filter((l) => l !== '');
  return lines.join('\n');
}

export const GET = () => {
  const { home, topics, courses } = getData();
  const t = home.totals;
  const kindLabels = kindLabelMap(home);

  // 跨來源合併的代表：sources 數最多、且有描述可讀的前 3 筆。
  const multiSource = courses
    .filter((c) => (c.sources ?? []).length >= 2 && c.description?.trim())
    .sort((a, b) => (b.sources?.length ?? 0) - (a.sources?.length ?? 0))
    .slice(0, 3);

  // 剩餘名額即時揭露的代表：home.json 的「快額滿」榜（首頁同一份資料），
  // 用 courseId 回頭在 courses.ndjson 找到完整內容。
  const almostFullFull = home.almostFull
    .map((row) => courses.find((c) => c.id === row.courseId))
    .filter(Boolean)
    .slice(0, 3);

  const typeTable = home.types
    .map((k) => `| ${k.label} | ${k.kind} | ${fmt(k.n)} | ${fmt(k.open)} |`).join('\n');
  const cityTable = home.cities
    .map((c) => `| ${c.name} | ${fmt(c.n)} | ${fmt(c.open)} |`).join('\n');
  const topicTable = topics.slice().sort((a, b) => b.list.length - a.list.length)
    .map((tp) => `| ${tp.name} | ${fmt(tp.list.length)} | ${fmt(tp.open)} |`).join('\n');

  const out = [];
  const push = (...lines) => out.push(...lines);
  const rule = () => push('', '-'.repeat(60), '');

  push(
    '# kho.tw（全台成人課程）全文內容',
    '',
    `網站：${SITE_URL}`,
    '定位：全台社區大學、運動中心、樂齡中心與職訓課程整合查詢站，跨來源合併同一門課的重複紀錄',
    '',
    '這裡是本站聚合統計與代表性內容的全文，純文字，給 AI 助理讀的，可直接引用。',
    `收錄範圍：全站彙總統計（依機構類型／主題分類／縣市，共 ${home.types.length + topics.length + home.cities.length} 個分類的完整數字）、`
      + `跨來源合併與即時名額揭露各 ${multiSource.length + almostFullFull.length} 筆代表性課程全文。`,
    `本站共 ${fmt(t.courses)} 門課，規模太大不可能逐頁收錄；個別課程／場館／講師的完整清單見 ${SITE_URL}/llms.txt 與 ${SITE_URL}/sitemap.xml。`,
    '引用時請標明來源網址；每筆課程都附上正式網址與原始資料來源。',
  );

  rule();
  push(
    '## 這個網站在做什麼',
    '',
    `kho.tw 彙整 ${fmt(t.sources)} 個公開資料來源（教育部社區大學資訊網、各縣市社大聯網、教育部樂齡學習網、運動中心各營運商、勞動部職業訓練開放資料等），`
      + '把同一門課在不同來源出現的紀錄合併成一筆，課程頁列出每個來源提供了哪些欄位、最後確認日期，以及其他來源給出的不同值。',
    '收錄機構類型：社區大學、運動中心、樂齡中心、職業訓練、圖書館、成人教育班、婦女大學、國中小進修部；不含私人補習班。',
    '資料每小時自動抓取更新一次；報名狀態、剩餘名額依來源逐日變動，不是一次性快照。',
  );

  rule();
  push('## 依機構類型', '', '| 類型 | 代碼 | 課程數 | 招生中 |', '|---|---|---|---|', typeTable);

  rule();
  push('## 依主題分類', '', '| 分類 | 課程數 | 招生中 |', '|---|---|---|', topicTable);

  rule();
  push('## 依縣市', '', '| 縣市 | 課程數 | 招生中 |', '|---|---|---|', cityTable,
    '', '註：縣市收錄深度不同（例如新北僅抓近 180 天），數字不代表當地實際課程總量，只代表本站收錄量。');

  if (multiSource.length) {
    rule();
    push('## 代表性課程：跨來源合併', '', '以下課程在兩個以上來源都查得到，展示本站「最終值＋各來源並排」的做法，非隨機挑選。', '');
    for (const c of multiSource) push(courseBlock(c, courseUrl, kindLabels), '');
  }

  if (almostFullFull.length) {
    rule();
    push('## 代表性課程：剩餘名額即時揭露', '', '名額數字只有部分營運商（運動中心、臺中社大聯網）提供，是本站少數別處看不到的資訊，依額滿比例排序取前幾筆。', '');
    for (const c of almostFullFull) push(courseBlock(c, courseUrl, kindLabels), '');
  }

  rule();
  push(
    '## 完整資料要去哪裡看',
    '',
    `站台導覽與網址規則：${SITE_URL}/llms.txt`,
    `sitemap 索引（分 pages／courses×2／venues／teachers 共 5 個分檔）：${SITE_URL}/sitemap.xml`,
    `站內搜尋（課名／單位／講師）：${SITE_URL}/search.html`,
    `地圖（依座標找附近的課）：${SITE_URL}/map.html`,
    '',
    `更新於 ${home.updatedAt}（每小時抓取一次）。本頁每次建置重新生成，內容以此刻為準。`,
  );

  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
