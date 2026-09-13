// ingest/sources/penghu-cc-portal.mjs
// 澎湖縣社區大學「當期課程介紹」。課程掛在縣府 CMS：`home.jsp?id=40` 是一張**人工維護的
// div 週課表**（`.lessoncontainer` 一欄一天、`.lesson` 一格一門課），每格連到該課自己的
// `home.jsp?id=<N>` 課程頁。`home.jsp?id=41` 的週課表是一張圖片，沒有文字可解，不要用。
//
// ⚠ 版面脆弱：格子是編輯器手打的，分隔符號有 `/`、`／`、`&nbsp;` 三種寫法，
// 也有 11 格標「課程準備中」且 `visibility:hidden`。所以解析全程寬容——
// **抓不到的那一格直接跳過，不讓整支炸掉**；課程頁抓失敗時仍保留週課表層的那一筆。
//
// 列表層每格三行：課程代碼／教師、課名、時段（`LM07 / 林美惠老師`／`曼陀鈴演奏班`／`18:30-21:30`）。
// 課程頁另有期別（`115年秋季班 / 曼陀鈴演奏班`）、課程類別、上課時間（含總時數）、
// 上課地點、教材費用、講師學經歷、課程目標、學員資格、教學方式、更新日期。
//
// **沒有費用金額、沒有名額、沒有已報名人數、沒有報名狀態、沒有門牌地址。**
// 報名走外部表單（surveycake，115 秋報名期間 8/17–8/26 已結束），那不是逐課的報名連結，
// 所以 registerUrl 不填。名額欄位一律留空（CONTRACT §5）。
//
// 實測 2026-09-13：50 格有課、49 個不重複課程頁 id（id=155 出現在兩天，視為一課兩堂）。
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';

const BASE = 'https://www.penghu.gov.tw/phcc/home.jsp?id=';
const INDEX_ID = 40;
const DELAY_MS = 1100;

export const meta = {
  id: 'penghu-cc-portal',
  name: '澎湖縣社區大學－當期課程介紹',
  org: '澎湖縣政府（澎湖縣社區大學）',
  homepage: 'https://www.penghu.gov.tw/phcc/',
  license: 'UNVERIFIED（站方未標示）',
  updateFreq: 'UNVERIFIED（人工維護的 CMS 頁面，課程頁更新日期實測 2026-08-13）',
  format: 'html',
  entity: 'course',
  // 沒有名額也沒有報名狀態，不是即時層；人工維護的頁面一期才動一次，7 天一輪。
  cadence: { kind: 'course-archive', boostMonths: [1, 2, 7, 8] },
  endpoints: [`${BASE}${INDEX_ID}`],
  recordCount: 50, // 實測 2026-09-13：50 格有課（另有 11 格「課程準備中」隱藏），49 門不重複
  verifiedAt: '2026-09-13',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TIME_RE = /\d{1,2}\s*:\s*\d{2}\s*[-~～]\s*\d{1,2}\s*:\s*\d{2}/;

// 週課表：`<div class="week">週一</div>` 之後的每個 `.lesson` 都屬於那一天。
// 用單一掃描式 regex 依文件順序走，不倚賴 container 的巢狀結構（那層最容易被編輯器改壞）。
const SCAN = /<div class="week">([^<]*)<\/div>|<div class="lesson"[^>]*>\s*<a\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

export function parseWeekGrid(html) {
  const out = [];
  let weekdayText = '';
  for (const m of html.matchAll(SCAN)) {
    if (m[1] !== undefined) {
      weekdayText = htmlText(m[1]);
      continue;
    }
    const href = m[2];
    const courseId = href.match(/id=(\d+)/)?.[1];
    if (!courseId) continue; // 連結壞掉的格子跳過，不中斷整批
    const lines = m[3].split(/<br\s*\/?>/i).map((l) => htmlText(l)).filter(Boolean);
    const timeText = lines.find((l) => TIME_RE.test(l)) ?? '';
    // 代碼／教師那行：帶「老師」或以兩碼英文＋兩碼數字的課程代碼開頭
    const headText = lines.find((l) => l !== timeText && /老師|^[A-Za-z]{2}\s*\d{2}/.test(l)) ?? '';
    const titleText = lines.find((l) => l !== timeText && l !== headText) ?? '';
    if (!titleText) continue; // 只有代碼沒有課名的格子（如「課程準備中」）跳過
    const [codePart = '', teacherPart = ''] = headText.split(/[／/]/);
    const codeText = /老師/.test(codePart) ? '' : codePart.trim();
    const teacherText = (/老師/.test(codePart) ? codePart : teacherPart).replace(/老師\s*$/, '').trim();
    out.push({
      courseId,
      weekdayText,
      timeText,
      codeText,
      teacherText,
      titleText,
      url: `${BASE}${courseId}`,
    });
  }
  return out;
}

// 課程頁：`<div class="ed_t3">115年秋季班 / 曼陀鈴演奏班</div>`，
// 基本資訊是 `<b>標籤：</b><ul><li>值</li></ul>`（也有少數直接接文字，兩種都吃），
// 其餘段落由 `<div class="ed_t4">段名</div>` 起、到下一個 `<hr>` 或段名為止。
export function parseDetail(html) {
  const body = html.match(/<div class="editor[^"]*">([\s\S]*?)<div class="visitors">/)?.[1] ?? html;
  const field = (label) => {
    const boxed = body.match(
      new RegExp(`<b>\\s*${label}\\s*[：:]?\\s*</b>([\\s\\S]*?)(?=<b>|<div class="ed_t4"|<hr|</td>)`),
    );
    const plain = boxed ? null : body.match(
      new RegExp(`${label}\\s*[：:]([\\s\\S]*?)(?=<b>|<div class="ed_t4"|<hr|</li>|</td>)`),
    );
    return htmlText((boxed ?? plain)?.[1] ?? '');
  };
  const section = (name) => htmlText(
    body.match(
      new RegExp(`<div class="ed_t4">\\s*${name}\\s*</div>([\\s\\S]*?)(?=<hr|<div class="ed_t4"|$)`),
    )?.[1] ?? '',
  );
  // 「115年秋季班 / 曼陀鈴演奏班」；分隔符號前後的空白與 &nbsp; 寫法不固定
  const heading = htmlText(body.match(/class="ed_t3">([\s\S]*?)<\/div>/)?.[1] ?? '');
  const [termPart = '', titlePart = ''] = heading.split('/');
  return {
    detailTitle: titlePart.trim(),
    termText: termPart.trim(),
    categoryText: field('課程類別'),
    detailTimeText: field('上課時間'),
    venueText: field('上課地點'),
    materialFeeText: field('教材費用'),
    teacherName: field('講師姓名'),
    teacherEduText: field('個人學歷'),
    teacherExpText: field('個人經歷'),
    goalText: section('課程目標'),
    audienceText: section('學員資格'),
    methodText: section('教學方式'),
    suppliesText: section('學員自備事項'),
    updatedText: html.match(/更新日期[：:]\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? '',
  };
}

const EMPTY_DETAIL = {
  detailTitle: '', termText: '', categoryText: '', detailTimeText: '', venueText: '',
  materialFeeText: '', teacherName: '', teacherEduText: '', teacherExpText: '',
  goalText: '', audienceText: '', methodText: '', suppliesText: '', updatedText: '',
};

export async function fetchRaw() {
  const indexHtml = await (await fetchWithRetry(`${BASE}${INDEX_ID}`)).text();
  const cells = parseWeekGrid(indexHtml);
  process.stderr.write(`[penghu-cc-portal] 週課表 ${cells.length} 格有課\n`);

  // 同一門課可能排在兩天（實測 id=155），合併成一筆、帶兩個時段
  const byId = new Map();
  for (const c of cells) {
    const prev = byId.get(c.courseId);
    if (prev) {
      prev.slotsText.push({ weekdayText: c.weekdayText, timeText: c.timeText });
      continue;
    }
    byId.set(c.courseId, {
      courseId: c.courseId,
      url: c.url,
      codeText: c.codeText,
      teacherText: c.teacherText,
      titleText: c.titleText,
      slotsText: [{ weekdayText: c.weekdayText, timeText: c.timeText }],
    });
  }

  const out = [];
  let detailOk = 0;
  for (const rec of [...byId.values()].sort((a, b) => Number(a.courseId) - Number(b.courseId))) {
    let detail = EMPTY_DETAIL;
    try {
      const html = await (await fetchWithRetry(rec.url)).text();
      detail = { ...EMPTY_DETAIL, ...parseDetail(html) };
      detailOk += 1;
    } catch (err) {
      process.stderr.write(`[penghu-cc-portal] 課程頁 id=${rec.courseId} 失敗：${err.message}\n`);
    }
    out.push({ ...rec, ...detail });
    await sleep(DELAY_MS);
  }
  process.stderr.write(`[penghu-cc-portal] 合計 ${out.length} 門，其中 ${detailOk} 門取得課程頁\n`);
  return out;
}

await runAsScript(import.meta.url, meta, fetchRaw);
