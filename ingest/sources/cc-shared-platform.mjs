// ingest/sources/cc-shared-platform.mjs
// 社大共用報名平台：twcc／twcu／twco／tycc／course.org.tw／frog.tw 等網域底下的站點，
// 用的是同一套系統，課表都在 <host>/course/m_course_list.php，一站一次請求就拿得到整期課表。
// 27 個站台 ≒ 27 所社大，只要 27 個請求，是最划算的一支。
//
// 站台清單來自教育部社大網 115 春季課程的 course_url 網域統計（2026-09-11 實測）。
//
// 兩件實測到的事：
// 1. 各站預設顯示模式不同（hidden input show_mode = week／txt／pic），版面也不同。
//    週課表（week）的 tooltip 欄位最完整，含招生人數、招生狀態、學校全名與上課地址；
//    圖片／條列模式（pic／txt）只有課名、開課日期、時段、區域、期別、教師。
//    所以兩種版面都要解，不猜參數、不強迫切換模式。
// 2. 這家平台會間歇性 503（同一站 11:46 正常、11:52 就 503），且瀏覽器 UA 也一樣 503，
//    不是擋爬蟲。單站失敗只記錄不中斷，等排程下一輪再補。
import { fetchWithRetry, htmlText, runAsScript } from './_util.mjs';

export const HOSTS = [
  'ss.twcc.org.tw', 'syp.tycc.org.tw', 'ty.twcc.org.tw', 'bt.twcu.org.tw',
  'xy.twcu.org.tw', 'wenshan.wenshan.org.tw', 'nangang.frog.tw', 'zscc.twcu.org.tw',
  'cl.tycc.org.tw', 'zb.course.org.tw', 'bcc.tycc.org.tw', 'whcc.twcu.org.tw',
  'lsy.tycc.org.tw', 'women.course.org.tw', 'kcu.twcu.org.tw', 's3c.twcc.org.tw',
  'hf.twcu.org.tw', 'encounter.twcu.org.tw', 'shulin.twco.org.tw',
  'eduyungho.community-univ.org', 'tds.twco.org.tw', 'takaocu.twcc.org.tw',
  'zd.course.org.tw', 'newchungho.twcc.org.tw', 'sycc.twcc.org.tw', 'tuchengcc.twco.org.tw',
  // 新竹縣豐湖社大（2026-09-13 補）：新竹縣社大聯網 hccu 站內的課程頁是 104 學年度廢棄資料，
  // 現役的三所（竹北 zb、竹東 zd、豐湖 fonghu）都跑在這個共用平台上，只有豐湖漏列。
  'fonghu.course.org.tw',
];

export const meta = {
  id: 'cc-shared-platform',
  name: '社區大學共用報名平台－課表',
  org: '各社區大學（共用同一家系統廠商）',
  homepage: 'https://s3c.twcc.org.tw/',
  license: 'UNVERIFIED（各校網站未標示）',
  updateFreq: 'UNVERIFIED（即時層，列表帶確認開課／額滿／停開旗標）',
  format: 'html',
  entity: 'course',
  cadence: { kind: 'course-live', boostMonths: [1, 2, 7, 8] },
  endpoints: HOSTS.map((h) => `https://${h}/course/m_course_list.php`),
  recordCount: 4077, // 實測 2026-09-13：25 站可用（ty、lsy 當輪 503），其中豐湖 89 門
  verifiedAt: '2026-09-13',
};

// tooltip 內容（週課表模式，欄位以 <br> 分行）：
//   ★篆刻輕鬆學—《飛鴻堂印譜》閒章賞讀與治印
//   開課日期：2026-08-31(星期一)
//   招生人數：30人
//   招生狀態：招生中
//   松山社區大學/松山社大
//   臺北市松山區八德路4段101號
function parseTooltip(tooltip) {
  const lines = tooltip.split(/<br\s*\/?>/i).map((s) => htmlText(s)).filter(Boolean);
  const out = { title: lines[0] ?? '', note: '' };
  const rest = [];
  for (const line of lines.slice(1)) {
    const kv = line.match(/^(開課日期|招生人數|招生狀態|上課地址)：\s*(.+)$/);
    if (!kv) { rest.push(line); continue; }
    if (kv[1] === '開課日期') {
      // 只收 YYYY-MM-DD；沒有 (星期X) 時不要把整串當日期存（曾存出「0000-00-00()」），
      // 來源用 0000-00-00 表示「日期未定」，那也不是日期。
      const m = kv[2].match(/(\d{4}-\d{2}-\d{2})(?:\s*\(星期([一二三四五六日])\))?/);
      if (m && m[1] !== '0000-00-00') {
        out.startDate = m[1];
        out.weekdayText = m[2] ?? '';
      }
    } else if (kv[1] === '招生人數') out.capacityText = kv[2];
    else if (kv[1] === '招生狀態') out.enrollStatusText = kv[2];
    else out.addressText = kv[2];
  }
  // 剩下的行：含「社區大學」的是校名，像地址的是地址，其餘當備註
  for (const line of rest) {
    if (/社區大學|社大/.test(line) && !out.schoolLine) out.schoolLine = line;
    else if (/[縣市].*[路街道段巷弄號]/.test(line) && !out.addressText) out.addressText = line;
    else if (!out.note) out.note = line;
  }
  return out;
}

// 週課表模式：<a class='course_info_link' href='…m_course_detail.php?u=HASH'
//   onmouseover='tooltip.show("…")'>課程代碼<br><b>課名</b><br><img/>教師<br>(一)19:00~21:40 …</a>
function parseWeekView(html, host) {
  const out = [];
  const re = /<a[^>]*class='course_info_link'[^>]*href='([^']*m_course_detail\.php\?u=([0-9a-f]+))'[^>]*onmouseover='tooltip\.show\("([\s\S]*?)"\);'[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const [, href, hash, tooltip, inner] = m;
    const tip = parseTooltip(tooltip);
    const innerText = htmlText(inner);
    const timeMatch = innerText.match(/\(([一二三四五六日])\)\s*(\d{1,2}:\d{2})~(\d{1,2}:\d{2})/);
    const codeMatch = innerText.match(/^(\S+?)\s/);
    out.push({
      host,
      view: 'week',
      courseHash: hash,
      url: href.startsWith('http') ? href : `https://${host}/course/${href}`,
      title: tip.title,
      note: tip.note,
      courseCode: codeMatch?.[1] ?? '',
      teacher: (innerText.match(/([一-龥]{2,4})\s*\([一二三四五六日]\)/) || [])[1] ?? '',
      startDate: tip.startDate ?? '',
      weekdayText: tip.weekdayText || timeMatch?.[1] || '',
      timeBegin: timeMatch?.[2] ?? '',
      timeEnd: timeMatch?.[3] ?? '',
      capacityText: tip.capacityText ?? '',
      statusText: tip.enrollStatusText ?? '',
      addressText: tip.addressText ?? '',
      schoolLine: tip.schoolLine ?? '',
      innerText,
    });
  }
  return out;
}

// 圖片／條列模式：<a href='m_course_detail.php?u=HASH' onmouseover='tooltip.show("…")'/>
//   <div class="content_box">…<h1><b>課名<span class='icon_special' title='確認開課'>開</span></b></h1>
//   <h2>開課日期：2026-08-31&nbsp;(一)下午</h2><h2>東區&nbsp;115-秋季班&nbsp;<img/>林建宏</h2></div></a>
function parseBoxView(html, host) {
  const out = [];
  const re = /<a\s+href='(m_course_detail\.php\?u=([0-9a-f]+))'[^>]*?onmouseover='tooltip\.show\("([\s\S]*?)"\);'[\s\S]*?<div class="content_box">([\s\S]*?)<\/div><\/a>/g;
  for (const m of html.matchAll(re)) {
    const [, path, hash, tooltip, box] = m;
    const tip = parseTooltip(tooltip);
    const flag = box.match(/class='icon_special'[^>]*title='([^']*)'/)?.[1] ?? '';
    const headings = [...box.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((h) => htmlText(h[1]));
    const dateLine = headings.find((h) => h.includes('開課日期')) ?? '';
    const metaLine = headings.find((h) => h !== dateLine) ?? '';
    const dm = dateLine.match(/開課日期：\s*([\d-]+)\s*\(([一二三四五六日])\)\s*(\S*)/);
    const mm = metaLine.match(/^(\S+)\s+(\S+期?班?)\s*(\S*)$/);
    out.push({
      host,
      view: 'box',
      courseHash: hash,
      url: `https://${host}/course/${path}`,
      title: tip.title,
      note: tip.note,
      courseCode: '',
      teacher: mm?.[3] ?? '',
      startDate: tip.startDate || dm?.[1] || '',
      weekdayText: tip.weekdayText || dm?.[2] || '',
      timeOfDay: dm?.[3] ?? '',
      capacityText: tip.capacityText ?? '',
      statusText: tip.enrollStatusText || flag,
      openFlag: flag,
      areaText: mm?.[1] ?? '',
      termText: mm?.[2] ?? '',
      addressText: tip.addressText ?? '',
    });
  }
  return out;
}

// 條列模式（show_mode=txt）是表格版，欄位最完整：
// <tr><td><a href='…?u=HASH' onmouseover='tooltip.show("課名<br>開課日期：2026-09-07(星期一)<br>")'/><img/></a></td>
//     <td>261D04<br/>115-秋季班</td><td><a…><b>課名</b>…<span class='icon_special' title='推薦課程'>推</span></a></td>
//     <td>(一)晚上</td><td>30</td><td><img/>朱增有</td><td>校本部</td><td>福和國中</td></tr>
function parseTableView(html, host) {
  const out = [];
  for (const tr of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const body = tr[1];
    const hash = body.match(/m_course_detail\.php\?u=([0-9a-f]+)/)?.[1];
    if (!hash) continue;
    const tooltip = body.match(/tooltip\.show\("([\s\S]*?)"\);/)?.[1] ?? '';
    const tip = parseTooltip(tooltip);
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => htmlText(c[1]));
    const flag = body.match(/class='icon_special'[^>]*title='([^']*)'/)?.[1] ?? '';
    const codeCell = cells[1] ?? '';
    const timeCell = cells[3] ?? '';
    const timeMatch = timeCell.match(/\(([一二三四五六日])\)\s*(\d{1,2}:\d{2})~(\d{1,2}:\d{2})/);
    out.push({
      host,
      view: 'table',
      courseHash: hash,
      url: `https://${host}/course/m_course_detail.php?u=${hash}`,
      title: tip.title || (cells[2] ?? ''),
      note: tip.note,
      courseCode: codeCell.split(/\s+/)[0] ?? '',
      teacher: cells[5] ?? '',
      startDate: tip.startDate ?? '',
      weekdayText: tip.weekdayText || timeCell.match(/\(([一二三四五六日])\)/)?.[1] || '',
      timeBegin: timeMatch?.[2] ?? '',
      timeEnd: timeMatch?.[3] ?? '',
      timeOfDay: timeMatch ? '' : timeCell.replace(/\([一二三四五六日]\)\s*/, ''),
      capacityText: cells[4] ?? '',
      statusText: tip.enrollStatusText ?? '',
      openFlag: flag,
      areaText: cells[6] ?? '',          // 學習中心（校本部／分部）
      addressText: tip.addressText ?? '',
      venueText: cells[7] ?? '',         // 上課地點（場地名，多為學校）
      termText: codeCell.match(/(\d{3}-?\S*[季期]班?)/)?.[1] ?? '',
    });
  }
  return out;
}

export async function fetchRaw() {
  const out = [];
  for (const host of HOSTS) {
    try {
      const html = await (await fetchWithRetry(`https://${host}/course/m_course_list.php`)).text();
      const schoolName = htmlText(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').replace(/\s*-.*$/, '');
      const week = parseWeekView(html, host);
      const box = week.length ? [] : parseBoxView(html, host);
      const table = week.length || box.length ? [] : parseTableView(html, host);
      const rows = [...week, ...box, ...table].map((r) => ({ ...r, schoolName }));
      process.stderr.write(`[cc-shared-platform] ${host} ${rows.length} 門（${schoolName}｜${rows[0]?.view ?? '無資料'}）\n`);
      out.push(...rows);
    } catch (err) {
      process.stderr.write(`[cc-shared-platform] ${host} 失敗：${err.message}\n`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r.host}:${r.courseHash}`;
    return !seen.has(k) && seen.add(k);
  });
}

await runAsScript(import.meta.url, meta, fetchRaw);
