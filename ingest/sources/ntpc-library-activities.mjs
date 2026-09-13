// ingest/sources/ntpc-library-activities.mjs
// 新北市立圖書館「活動報名」系統（atpass.ntpclib.gov.tw）——全市 100 多座分館的活動報名總表。
//
// 這是本站少數拿得到**剩餘名額**的來源之一：列表每張卡片都寫「已報名/名額 14/20」，
// 兩個數字都在同一個欄位裡，相減就是還剩幾個位子（CONTRACT §5 要的 available）。
//
// ── 取得方式 ──
// 列表頁 GET 一次拿到第 1 頁、CSRF token 與總頁數（頁尾「共 N 頁」），
// 其餘頁用 POST 同一個網址翻頁（form 參數 page／isPage／pageSize／orderField／orderType）。
// ⚠ `pageSize` 伺服器端被夾在 10：送 200 回來的頁面 `pageSize` 欄位仍是 10、仍然「共 11 頁」，
// 所以不能靠加大每頁筆數少發請求，只能老實翻頁（實測 11 頁、每頁 10 筆）。
//
// ⚠ 「共 11 頁 × 每頁 10 筆」**不等於 110 個場次**：伺服器端的分頁會重複吐同一列，
// 有的單頁內部就出現兩筆一模一樣的（實測 asc 的 p5、p9、p11）。11 頁抓完去重後是 **54 筆**。
// 這不是漏抓：以 `orderType=asc` 與 `desc` 各抓 11 頁，兩邊各自去重都剛好 54 筆、
// 聯集也是 54 筆（2026-09-13 實測），兩個方向看到的是同一組場次。
// 所以本支用「跨頁去重後的集合」當結果，不用頁數 × 每頁筆數推估總量。
// ⚠ POST 需要帶 csrfToken（同時以 `csrfToken` 與 `_csrf` 兩個名字送出，表單兩者都有）
// 與列表頁發的 session cookie，少任何一個都拿不到第 2 頁。token 每次執行重新取得，不可寫死。
//
// ── 一列是一個「場次」，不是一個活動 ──
// 同一個活動的不同場次各有自己的日期、名額與報名起訖，列表本來就是按場次展開的。
//
// ⚠ 場次識別碼只有「還能報名」的卡片才有：未額滿的卡片有
// `showSessionDetail('<32 hex>')` 按鈕，**已額滿的卡片只有一張圖片、沒有這段 JS**。
// 所以 sessionId 會缺，normalize 端得自己補一個穩定鍵（見該檔）。這裡照實回傳，缺就是空字串。
//
// 憑證：實測 Node v22 原生 fetch 可直接建立 TLS 連線，不需要任何額外處理。
// robots.txt：atpass.ntpclib.gov.tw/robots.txt 回 404（沒有 robots 檔）。
// 全程序列請求、每次間隔 1.1 秒，只讀公開列表，不碰任何需要登入的路徑。
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';

// svcId 是「活動報名」這個服務的識別碼，出現在館方官網首頁的連結上，不是每次變動的值。
const SVC_ID = '8e109e8bb57a4b44b21e31c34db87dba';
const LIST = `https://atpass.ntpclib.gov.tw/activities/${SVC_ID}`;
const MAX_PAGES = 60; // 實測 11 頁；上限只是防呆，避免頁數解析錯誤時無限翻頁
const DELAY_MS = 1100;

export const meta = {
  id: 'ntpc-library-activities',
  name: '新北市立圖書館－活動報名',
  org: '新北市立圖書館',
  homepage: 'https://atpass.ntpclib.gov.tw/',
  license: 'UNVERIFIED（站方未標示；robots.txt 回 404）',
  updateFreq: 'UNVERIFIED（報名系統，名額與狀態即時變動）',
  format: 'html',
  entity: 'course',
  // 有剩餘名額與報名起訖，是最典型的即時層。
  cadence: { kind: 'course-live' },
  endpoints: [LIST],
  recordCount: 54, // 實測 2026-09-13：11 頁抓完去重後 54 筆（asc／desc 兩種排序的聯集同樣是 54）
  verifiedAt: '2026-09-13',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pick = (html, re) => htmlText(html.match(re)?.[1] ?? '');

// 一張卡片 → 一個場次。欄位全部照頁面原樣取字串，不解析日期、不相減名額。
export function parseCards(html) {
  const out = [];
  // 卡片以 <div class="eventsApplyListDetail"> 開頭，到該 <li> 結束為止
  for (const chunk of html.split('<div class="eventsApplyListDetail">').slice(1)) {
    const card = chunk.split('</li>')[0];
    const titleBlock = card.match(/<p class="listDetailTitleText">([\s\S]*?)<\/p>/)?.[1] ?? '';
    // 「活動：X<br>場次：Y」——用 <br> 切開，兩段各自去標籤
    const [actPart = '', sesPart = ''] = titleBlock.split(/<br\s*\/?>/);
    const activityTitle = htmlText(actPart).replace(/^活動[：:]\s*/, '');
    const sessionTitle = htmlText(sesPart).replace(/^場次[：:]\s*/, '');
    if (!activityTitle) continue;

    const regTimes = card.match(
      /<div class="listMessageTimeText">\s*<p>([\s\S]*?)<\/p>\s*<span>~<\/span>\s*<p>([\s\S]*?)<\/p>/,
    );
    // 狀態文字在按鈕的 aria-label（「我要報名，活動：…」）或圖片的 alt（「已額滿，活動：…」）裡，
    // 取到第一個全形逗號為止就是狀態本身。
    const stateText = htmlText(
      card.match(/(?:aria-label|alt)="([^"，]{2,12})，活動[：:]/)?.[1] ?? '',
    );

    out.push({
      sessionId: card.match(/showSessionDetail\('([0-9a-f]{32})'\)/)?.[1] ?? '',
      activityTitle,
      sessionTitle,
      activityDateText: pick(card, /<div class="listDetailDataTime">\s*<span>([\s\S]*?)<\/span>/),
      excerptText: pick(card, /<p class="eventsApplyListContainerText">([\s\S]*?)<\/p>/),
      // 「已報名/名額」，例：14/20
      quotaText: pick(card, /<div class="listMessageQuota">[\s\S]*?<p>([\s\S]*?)<\/p>/),
      waitlistText: pick(card, /<div class="listMessageAlternate">[\s\S]*?<p>([\s\S]*?)<\/p>/),
      registerStartText: htmlText(regTimes?.[1] ?? ''),
      registerEndText: htmlText(regTimes?.[2] ?? ''),
      stateText,
      url: LIST,
    });
  }
  return out;
}

function parseTotalPages(html) {
  const n = Number(htmlText(html).match(/共\s*(\d+)\s*頁/)?.[1]);
  return Number.isInteger(n) && n > 0 ? n : 1;
}

export async function fetchRaw() {
  // 第一次 GET：拿第 1 頁內容、CSRF token 與 session cookie
  const first = await fetchWithRetry(LIST);
  const cookie = (first.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ');
  const firstHtml = await first.text();
  const token = firstHtml.match(/name="csrfToken"\s+value="([0-9a-fA-F-]+)"/)?.[1];
  if (!token) throw new Error('找不到 csrfToken，頁面結構可能已改');
  const totalPages = Math.min(parseTotalPages(firstHtml), MAX_PAGES);

  const byKey = new Map();
  const add = (rows, page) => {
    const before = byKey.size;
    for (const r of rows) {
      // 額滿卡片沒有 sessionId，改用「活動＋場次＋日期」當去重鍵（normalize 也用同一組值）
      const key = r.sessionId || `${r.activityTitle}|${r.sessionTitle}|${r.activityDateText}`;
      if (!byKey.has(key)) byKey.set(key, r);
    }
    process.stderr.write(
      `[ntpc-library-activities] page=${page} ${rows.length} 筆（新增 ${byKey.size - before}）\n`,
    );
    return byKey.size - before;
  };

  add(parseCards(firstHtml), 1);

  for (let page = 2; page <= totalPages; page++) {
    await sleep(DELAY_MS);
    const body = new URLSearchParams({
      csrfToken: token,
      _csrf: token,
      page: String(page),
      isPage: 'true',
      pageSize: '10',
      orderField: 'registrationStart',
      orderType: 'asc',
    });
    const res = await fetchWithRetry(LIST, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...(cookie ? { Cookie: cookie } : {}),
        Referer: LIST,
      },
      body: body.toString(),
    });
    add(parseCards(await res.text()), page);
  }

  const out = [...byKey.values()];
  const withQuota = out.filter((r) => /^\d+\s*\/\s*\d+$/.test(r.quotaText)).length;
  process.stderr.write(
    `[ntpc-library-activities] 合計 ${out.length} 筆（共 ${totalPages} 頁），其中 ${withQuota} 筆有「已報名/名額」\n`,
  );
  return out;
}

await runAsScript(import.meta.url, meta, fetchRaw);
