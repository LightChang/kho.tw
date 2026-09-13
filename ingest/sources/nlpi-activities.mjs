// ingest/sources/nlpi-activities.mjs
// 國立公共資訊圖書館活動報名系統（講座、研習、展覽、電影欣賞那類成人活動）。
//
// ⚠ 端點換過：官網的 `www.nlpi.edu.tw/ActivityInfo/recap/Search?pageIndex=N` **分頁失效**
// （pageIndex=1 回的內容與 0 一模一樣，只拿得到前 10 筆），不要用。真正的來源是報名平台
// `activity.nlpi.edu.tw/ActiveList.aspx?n=3&sms=10294&page=<N>&PageSize=12`。
//
// ⚠ 分頁終止條件不能用「空頁」：實測 page=6 回的是最後一頁的 6 筆（伺服器把超界頁夾到最後一頁），
// 抓到空頁才停會變成無窮迴圈。所以用 ss 去重，**某一頁沒帶來新的 ss 就停**。
//
// 列表給：活動名稱、活動起迄、報名起迄、分眾、類別、狀態、餘額。
// 詳情 `Active_Content.aspx?n=3&ss=<16 hex>` 給：報名時間（到分）、活動時間、內容簡介，
// 以及場次表（場次名稱、地點、活動開始時間、報名截止時間、**剩餘名額**）。
// 54 筆逐筆抓詳情＝54 次請求、序列、間隔 1.1 秒，約一分鐘，值得——地點與剩餘名額只在那裡。
//
// 名額語意（實測 2026-09-13）：列表「餘額」是**各場次剩餘名額的總和**
// （ss=90F2A0521C93A50E 列表 642 ＝ 場次 218＋214＋210）。多場次活動的總和不是
// 「這個活動還剩幾個位子」，normalize 只在單場次時才填 available（見該檔註解）。
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';

const LIST = (page) => `https://activity.nlpi.edu.tw/ActiveList.aspx?n=3&sms=10294&page=${page}&PageSize=12`;
const DETAIL = (ss) => `https://activity.nlpi.edu.tw/Active_Content.aspx?n=3&ss=${ss}`;
const MAX_PAGES = 20; // 實測 5 頁 54 筆；上限只是防呆
const DELAY_MS = 1100;

export const meta = {
  id: 'nlpi-activities',
  name: '國立公共資訊圖書館－活動報名',
  org: '教育部國立公共資訊圖書館',
  homepage: 'https://activity.nlpi.edu.tw/',
  license: 'UNVERIFIED（站方未標示；activity 子網域 robots.txt 回 404，主站 robots.txt 無 Disallow）',
  updateFreq: 'UNVERIFIED（報名平台，列表混有已結束與常態性活動）',
  format: 'html',
  entity: 'course',
  // 詳情頁有剩餘名額、列表有報名狀態，是即時層；報名季 boost 對單場活動意義不大，不設。
  cadence: { kind: 'course-live' },
  endpoints: [LIST(1)],
  recordCount: 54, // 實測 2026-09-13：page 1–4 各 12 筆、page 5 六筆
  verifiedAt: '2026-09-13',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cellOf = (row, name) => htmlText(
  row.match(new RegExp(`data-title='${name}'><span[^>]*>([\\s\\S]*?)</span>`))?.[1] ?? '',
);

export function parseList(html) {
  const out = [];
  for (const m of html.matchAll(/<tr><td data-title='標題'>([\s\S]*?)<\/tr>/g)) {
    const row = m[1];
    const activityId = row.match(/ss=([0-9A-Fa-f]+)/)?.[1];
    if (!activityId) continue;
    const title = htmlText(row.match(/<a [^>]*>([\s\S]*?)<\/a>/)?.[1] ?? '');
    if (!title) continue;
    out.push({
      activityId,
      title,
      url: DETAIL(activityId),
      listActivityRangeText: cellOf(row, '活動起迄'),
      listRegisterRangeText: cellOf(row, '報名起迄'),
      audienceText: cellOf(row, '分眾'),
      categoryText: cellOf(row, '類別'),
      statusText: cellOf(row, '狀態'),
      listRemainingText: cellOf(row, '餘額'),
    });
  }
  return out;
}

// 詳情：`<ul id="ActiveInfo">` 裡是 報名時間／活動時間／內容簡介；
// 內容簡介本身含巢狀 <p>，所以抓到下一個 <li> 為止，不用非貪婪的 </p>。
export function parseDetail(html) {
  const info = html.match(/<ul id="ActiveInfo">([\s\S]*?)<\/ul>/)?.[1] ?? '';
  const labelled = (label) => htmlText(
    info.match(new RegExp(`<p class="title">\\s*${label}\\s*</p>\\s*<p>([\\s\\S]*?)</p>`))?.[1] ?? '',
  );
  const intro = htmlText(info.match(/內容簡介\s*<\/p>([\s\S]*?)(?=<li\b|<\/ul>)/)?.[1] ?? '');
  const sessions = [];
  for (const m of html.matchAll(/<tr><td data-title='場次'>([\s\S]*?)<\/tr>/g)) {
    const row = `<td data-title='場次'>${m[1]}`;
    sessions.push({
      no: cellOf(row, '場次'),
      name: cellOf(row, '場次名稱'),
      venueText: cellOf(row, '地點'),
      startText: cellOf(row, '活動開始時間'),
      deadlineText: cellOf(row, '報名截止時間'),
      remainingText: cellOf(row, '剩餘名額'),
    });
  }
  return {
    registerTimeText: labelled('報名時間'),
    activityTimeText: labelled('活動時間'),
    introText: intro,
    sessions,
  };
}

const EMPTY_DETAIL = { registerTimeText: '', activityTimeText: '', introText: '', sessions: [] };

export async function fetchRaw() {
  const byId = new Map();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await (await fetchWithRetry(LIST(page))).text();
    const rows = parseList(html);
    const before = byId.size;
    for (const r of rows) if (!byId.has(r.activityId)) byId.set(r.activityId, r);
    process.stderr.write(`[nlpi-activities] page=${page} ${rows.length} 筆（新增 ${byId.size - before}）\n`);
    await sleep(DELAY_MS);
    if (byId.size === before) break; // 超界頁會重播最後一頁，沒有新 ss 就是抓完了
  }

  const out = [];
  let detailOk = 0;
  for (const rec of [...byId.values()]) {
    let detail = EMPTY_DETAIL;
    try {
      const html = await (await fetchWithRetry(rec.url)).text();
      detail = { ...EMPTY_DETAIL, ...parseDetail(html) };
      detailOk += 1;
    } catch (err) {
      process.stderr.write(`[nlpi-activities] 詳情 ss=${rec.activityId} 失敗：${err.message}\n`);
    }
    out.push({ ...rec, ...detail });
    await sleep(DELAY_MS);
  }
  out.sort((a, b) => a.activityId.localeCompare(b.activityId));
  const withQuota = out.filter((r) => r.sessions.some((s) => /^\d+$/.test(s.remainingText))).length;
  process.stderr.write(
    `[nlpi-activities] 合計 ${out.length} 筆，其中 ${detailOk} 筆取得詳情、${withQuota} 筆有數字型剩餘名額\n`,
  );
  return out;
}

await runAsScript(import.meta.url, meta, fetchRaw);
