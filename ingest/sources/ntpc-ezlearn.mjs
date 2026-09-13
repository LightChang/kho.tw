// ingest/sources/ntpc-ezlearn.mjs
// 新北市數位樂學網。涵蓋樂齡中心、松年大學、婦女大學，是本專案唯一有完整報名生命週期
// （公告→線上報名→錄取→繳費→開課）的樂齡來源。伺服器端 HTML，每頁 6 張卡片。
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';

const LIST = 'https://ezlearn.ntpc.gov.tw/courses';
const PER_PAGE = 6;
const MAX_PAGES = 250;

export const meta = {
  id: 'ntpc-ezlearn',
  name: '新北市數位樂學網－課程總覽',
  org: '新北市政府教育局',
  homepage: 'https://ezlearn.ntpc.gov.tw/',
  license: 'UNVERIFIED（站方未標示）',
  updateFreq: 'UNVERIFIED（依招生期程公告，實測 1024 筆）',
  format: 'html',
  entity: 'course',
  cadence: { kind: 'course-live', boostMonths: [1, 2, 7, 8] },
  endpoints: [LIST],
  recordCount: 1024, // 實測 2026-09-12
  verifiedAt: '2026-09-12',
};

// 每張卡片是 <div class="col card-outer"> … onclick="…/courses/detail/21464" … </div>
// 卡片內是「標籤：值」的純文字，欄位名固定，直接對文字抓比解 DOM 穩。
function parseCards(html) {
  const cards = [];
  for (const m of html.matchAll(/<div class="col card-outer">([\s\S]*?)(?=<div class="col card-outer">|<\/div>\s*<\/div>\s*<\/div>)/g)) {
    const block = m[1];
    const id = block.match(/\/courses\/detail\/(\d+)/)?.[1];
    if (!id) continue;
    const text = htmlText(block);
    const field = (label, stop) => {
      const re = new RegExp(`${label}\\s*([\\s\\S]*?)(?=\\s*(?:${stop})|$)`);
      return text.match(re)?.[1]?.trim() ?? '';
    };
    const STOPS = '報名日期|開課日期|課程類別|課程地區|承辦單位|招生人數|瞭解詳情';
    cards.push({
      courseId: id,
      title: text.split(/報名日期/)[0].trim(),
      registerRange: field('報名日期', STOPS),
      startDateText: field('開課日期', STOPS),
      categoryText: field('課程類別', STOPS),
      areaText: field('課程地區', STOPS),
      providerText: field('承辦單位', STOPS),
      capacityText: field('招生人數', STOPS),
    });
  }
  return cards;
}

export async function fetchRaw() {
  const first = await (await fetchWithRetry(LIST)).text();
  const total = Number((first.match(/共\s*([\d,]+)\s*筆/)?.[1] ?? '0').replace(/,/g, ''));
  const pages = Math.min(MAX_PAGES, Math.ceil(total / PER_PAGE) || 1);
  const out = [...parseCards(first)];
  for (let page = 2; page <= pages; page++) {
    await new Promise((r) => setTimeout(r, 2000));
    const html = await (await fetchWithRetry(`${LIST}?page=${page}`)).text();
    const cards = parseCards(html);
    if (cards.length === 0) break;
    out.push(...cards);
  }
  process.stderr.write(`[ntpc-ezlearn] 站方宣告 ${total} 筆，抓到 ${out.length} 筆\n`);
  const seen = new Set();
  return out.filter((r) => !seen.has(r.courseId) && seen.add(r.courseId));
}

await runAsScript(import.meta.url, meta, fetchRaw);
