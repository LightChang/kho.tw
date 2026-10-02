// src/lib/sitemap-integration.mjs
// Astro 建置完成後產出 sitemap index、分檔 sitemap 與 robots.txt。
//
// 不用 @astrojs/sitemap：它給不了本站要的三件事——依資料日期的 lastmod、依報名狀態的
// priority／changefreq、以及 pages／courses／venues／teachers 分組分檔（理由見 site/sitemap.mjs）。
// XML 本身仍由 site/sitemap.mjs 的 writeSitemaps() 產生，site/check-sitemap.mjs 照舊驗。
//
// 條目由資料推出來，再逐一確認檔案真的在 dist/ 裡：KHO_LIMIT 開發模式只產部分課程頁，
// 不這樣過濾的話 sitemap 會收到指向不存在檔案的網址。
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getData, learnRel, certRel, programRel, freeRel, seniorRel, hasEnded, isNoindex } from './data.mjs';
import { SITE_URL } from '../../site/jsonld.mjs';
import { writeSitemaps, courseHint, maxDate, isSitemapExcluded } from '../../site/sitemap.mjs';

// lastmod 用資料實際的更新日期，不用 build 當下的時間（理由見 site/sitemap.mjs）。
// 彙整頁取它收錄的課程的最大值。
// 2026-09-27 起取「內容真正變更」的日子（data/observation 的 lastChangedAt），不是最後確認日——
// 後者每輪抓取都刷新，會讓全站天天標今天。規則見 site/sitemap.mjs 的 courseChangedAt()。
function entries(d) {
  const courseLastmod = (c) => d.changedAt.get(c.id);
  const listLastmod = (list) => maxDate(list.map(courseLastmod));
  const allLastmod = listLastmod(d.courses);
  const pages = [
    { rel: 'index.html', lastmod: allLastmod, changefreq: 'daily', priority: '1.0' },
    { rel: 'open.html', lastmod: listLastmod(d.openCourses), changefreq: 'daily', priority: '0.9' },
    { rel: 'types.html', lastmod: listLastmod(d.courses), changefreq: 'weekly', priority: '0.7' },
    ...d.types.map((k) => ({ rel: `type/${k.kind}.html`, lastmod: listLastmod(k.list), changefreq: 'weekly', priority: '0.7' })),
    { rel: 'topics.html', lastmod: listLastmod(d.courses), changefreq: 'weekly', priority: '0.8' },
    ...d.topics.map((t) => ({ rel: `topic/${t.name}.html`, lastmod: listLastmod(t.list), changefreq: 'weekly', priority: '0.7' })),
    { rel: 'cities.html', lastmod: listLastmod(d.courses), changefreq: 'weekly', priority: '0.7' },
    ...d.cities.map((c) => ({ rel: `city/${c.name}.html`, lastmod: listLastmod(c.list), changefreq: 'weekly', priority: '0.7' })),
    { rel: 'map.html', lastmod: allLastmod, changefreq: 'weekly', priority: '0.8' },
    { rel: 'teachers.html', lastmod: listLastmod(d.courses), changefreq: 'weekly', priority: '0.6' },
    { rel: 'search.html', lastmod: allLastmod, changefreq: 'monthly', priority: '0.6' },
    // 細項（皮拉提斯、水電…）與證照班：全國、縣市、行政區三層，門檻見 data.mjs 的 FACET_MIN
    { rel: 'learn.html', lastmod: listLastmod(d.courses), changefreq: 'weekly', priority: '0.8' },
    ...d.learn.flatMap((l) => [
      { rel: learnRel(l.activity.name), lastmod: listLastmod(l.list), changefreq: 'weekly', priority: '0.7' },
      ...[...l.cities, ...l.districts].map((x) => ({
        rel: learnRel(l.activity.name, x.area), lastmod: listLastmod(x.list), changefreq: 'weekly', priority: '0.6',
      })),
    ]),
    { rel: certRel(), lastmod: listLastmod(d.cert.list), changefreq: 'weekly', priority: '0.7' },
    ...d.cert.cities.map((x) => ({ rel: certRel(x.city), lastmod: listLastmod(x.list), changefreq: 'weekly', priority: '0.6' })),
    // 需求專題（2026-09-28）：職訓方案、免費課、銀髮課；報名狀態每天在變，給 daily
    ...d.programs.flatMap((p) => [
      { rel: programRel(p.key), lastmod: listLastmod(p.list), changefreq: 'daily', priority: '0.8' },
      ...p.cities.map((x) => ({ rel: programRel(p.key, x.city), lastmod: listLastmod(x.list), changefreq: 'daily', priority: '0.7' })),
    ]),
    ...[[d.free, freeRel], [d.senior, seniorRel]].flatMap(([h, rel]) => [
      { rel: rel(), lastmod: listLastmod(h.list), changefreq: 'daily', priority: '0.8' },
      ...h.cities.map((x) => ({ rel: rel(x.city), lastmod: listLastmod(x.list), changefreq: 'daily', priority: '0.7' })),
    ]),
  ];
  // 停開與已截止的課仍然收錄，只是 priority 低、changefreq 長（見 site/sitemap.mjs）。
  // 上課已經結束的課比照「已截止」：來源常把狀態留在「狀態未知」或「開課中」，
  // 照報名狀態給會讓一萬多頁過期課拿到 0.5–0.6、每週回抓，跟招生中的課搶抓取預算。
  // 報名狀態本身不動（頁面照來源寫），這裡只調給搜尋引擎的提示。
  // 結束滿一年的課程頁是 noindex，不進 sitemap（site/check-sitemap.mjs 會驗兩邊一致）
  const courses = d.courses.filter((c) => !isNoindex(c)).map((c) => ({
    rel: `course/${c.slug}.html`, lastmod: courseLastmod(c),
    ...courseHint(hasEnded(c) && c.enrollment?.status !== 'cancelled' ? 'closed' : c.enrollment?.status),
  }));
  // 薄場館頁（≤2 門課且全部已結束）是 noindex，不進 sitemap（規則見 data.mjs 的 isThinVenue）
  const venues = d.venuePages.filter((p) => !p.noindex).map(({ venue, list }) => ({
    rel: `venue/${venue.slug}.html`, lastmod: listLastmod(list), changefreq: 'weekly', priority: '0.5',
  }));
  const teachers = d.teachers.map(({ teacher, list }) => ({
    rel: `teacher/${teacher.slug}.html`, lastmod: listLastmod(list), changefreq: 'weekly', priority: '0.5',
  }));
  // 場館 × 細項（/at/，2026-10-02）：本期課的清單，報名狀態每天在變
  const venueActs = d.venueActs.map((x) => ({
    rel: x.rel, lastmod: listLastmod(x.list), changefreq: 'daily', priority: '0.7',
  }));
  return { pages, courses, venues, 'venue-acts': venueActs, teachers };
}

export default function khoSitemap() {
  return {
    name: 'kho-sitemap',
    hooks: {
      'astro:build:done': async ({ dir, logger }) => {
        const dist = fileURLToPath(dir);
        // public/ 會整包複製進 dist/，但 home.json 是 emit 給建置用的中間檔、不是給讀者的
        await rm(path.join(dist, 'home.json'), { force: true });
        const groups = Object.entries(entries(getData())).map(([name, list]) => ({
          name,
          // 排除頁型不進 sitemap，清單見 site/sitemap.mjs 的 SITEMAP_EXCLUDED_DIRS（2026-10-02 起為空）
          entries: list.filter((e) => !isSitemapExcluded(e.rel) && existsSync(path.join(dist, e.rel))),
        }));
        const sitemap = await writeSitemaps({ dist, siteUrl: SITE_URL, groups });
        const counts = groups.map((g) => `${g.name} ${g.entries.length}`).join('、');
        logger.info(`sitemap：${sitemap.total} 個 URL（${counts}），分 ${sitemap.files.length} 檔 ＋ robots.txt`);
      },
    },
  };
}
