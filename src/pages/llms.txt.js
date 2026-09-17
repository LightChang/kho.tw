// src/pages/llms.txt.js
// /llms.txt：給 LLM 的站台導覽檔——目錄性質，不是全文（全文見 /llms-full.txt）。
// 本站 42,000+ 頁不可能逐頁列，這裡只收斂到「機構類型／主題分類／縣市」這種可收斂的層級，
// 並說明網址規則讓 AI 自己組出個別課程／場館／講師頁的網址。
//
// 內容全部取自 getData()（build 當下讀 data/ 的真實資料），不手寫任何數字或清單——
// ops/run-host.sh 每小時 ingest 一次，寫死的數字隔天就過期（見 docs/GEO.md 開頭的規則）。
import { getData, fmt, STATUS_LABEL } from '../lib/data.mjs';
import { SITE_URL, courseUrl, venueUrl, teacherUrl } from '../../site/jsonld.mjs';

export const GET = () => {
  const { home, topics, coursePages, venuePages, teachers } = getData();
  const t = home.totals;
  const exampleCourse = coursePages[0]?.course;
  const exampleVenue = venuePages[0]?.venue;
  const exampleTeacher = teachers[0]?.teacher;

  const typeLines = home.types
    .map((k) => `- ${k.label}（${k.kind}）：${SITE_URL}/type/${k.kind}.html（${fmt(k.n)} 門，${fmt(k.open)} 門招生中）`)
    .join('\n');

  const topicLines = topics.slice().sort((a, b) => b.list.length - a.list.length)
    .map((tp) => `- ${tp.name}：${SITE_URL}/topic/${encodeURIComponent(tp.name)}.html（${fmt(tp.list.length)} 門，${fmt(tp.open)} 門招生中）`)
    .join('\n');

  const cityLines = home.cities
    .map((c) => `- ${c.name}：${SITE_URL}/city/${encodeURIComponent(c.name)}.html（${fmt(c.n)} 門，${fmt(c.open)} 門招生中）`)
    .join('\n');

  const body = `# kho.tw（全台成人課程）

> 全台社區大學、運動中心、樂齡中心與職訓課程整合查詢站。收錄 ${fmt(t.courses)} 門課、${fmt(t.venues)} 個上課地點，其中 ${fmt(t.open)} 門正在招生。資料每小時自動抓取更新，本頁與 /llms-full.txt 在每次建置時重新生成。

## 這是什麼
kho.tw 彙整 ${fmt(t.sources)} 個公開資料來源（教育部社區大學資訊網、各縣市社大聯網、教育部樂齡學習網、運動中心各營運商、勞動部職業訓練開放資料等），把同一門課在不同來源出現的紀錄合併成一筆，並在每個課程頁列出各來源提供的欄位與最後確認日期。收錄範圍：社區大學、運動中心、樂齡中心、職業訓練、圖書館、成人教育班、婦女大學、國中小進修部等機構公開的課程／活動資訊；不含私人補習班。

## 頁面種類與入口

### 依機構類型（共 ${home.types.length} 類，網址：/type/<kind 代碼>.html）
${typeLines}

### 依主題分類（共 ${topics.length} 類，網址：/topic/<分類名稱>.html；分類名稱為中文，須百分比編碼）
${topicLines}

### 依縣市（共 ${home.cities.length} 縣市，網址：/city/<縣市名稱>.html；縣市名稱為中文，須百分比編碼）
${cityLines}

### 課程頁（本站最大宗，共 ${fmt(coursePages.length)} 頁）
每門課一頁。網址規則：/course/<slug>.html，slug 是「課名-開課單位-短碼」，中文，每一段都要依 RFC 3986 百分比編碼，例如：
  ${exampleCourse ? courseUrl(exampleCourse) : ''}
slug 由 data/slugs.ndjson 登記簿配給並保證重跑不變，不可自行推測；要拿到某門課的正確網址，請走下面的完整清單（sitemap 或站內搜尋），不要自己拼字串。

### 場館頁（共 ${fmt(venuePages.length)} 頁）
網址規則：/venue/<slug>.html，例如：
  ${exampleVenue ? venueUrl(exampleVenue) : ''}

### 講師頁（只收同名同單位開課 ≥2 門者，共 ${fmt(teachers.length)} 頁）
網址規則：/teacher/<slug>.html，例如：
  ${exampleTeacher ? teacherUrl(exampleTeacher) : ''}
身分認定＝姓名＋開課單位，同名不同人不會被合併。

## 其他重要頁面
- 首頁：${SITE_URL}/
- 現在可報名：${SITE_URL}/open.html
- 全部機構類型：${SITE_URL}/types.html
- 全部主題分類：${SITE_URL}/topics.html
- 全部縣市：${SITE_URL}/cities.html
- 地圖（依座標找附近的課）：${SITE_URL}/map.html
- 講師索引（開課數前 300 名）：${SITE_URL}/teachers.html
- 搜尋（課名／單位／講師）：${SITE_URL}/search.html

## 完整網址清單
單一課程／場館／講師的網址請勿自行拼湊，一律從下列來源取得：
- sitemap 索引：${SITE_URL}/sitemap.xml（分 pages／courses×2／venues／teachers 共 5 個分檔）
- robots.txt：${SITE_URL}/robots.txt（全站開放檢索，未擋任何 AI 爬蟲）
- 站內搜尋：${SITE_URL}/search.html

## 別處看不到的資訊
- **跨來源合併＋來源並排**：同一門課在多個來源出現時，課程頁列出每個來源提供了哪些欄位、最後確認日期，以及其他來源給出的不同值
- **剩餘名額倒數**：只有部分營運商（運動中心、臺中社大聯網）提供，首頁「快額滿」與課程頁會揭露
- **每日更新的報名狀態**：${Object.values(STATUS_LABEL).join('、')} 等狀態依來源逐日更新，不是一次性快照

## 全文版
含代表性課程全文與資料來源明細的版本：${SITE_URL}/llms-full.txt

## 更新
資料最後更新於 ${home.updatedAt}（每小時抓取一次，見 ops/run-host.sh）。本頁每次建置重新生成，數字與清單以此刻為準，不會過期。
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
