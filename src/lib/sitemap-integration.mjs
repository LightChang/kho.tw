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
import { getData } from './data.mjs';
import { SITE_URL } from '../../site/jsonld.mjs';
import { writeSitemaps, courseHint, maxDate } from '../../site/sitemap.mjs';

// lastmod 用資料實際的更新日期，不用 build 當下的時間（理由見 site/sitemap.mjs）。
// 課程的日期在各來源的 lastVerifiedAt 上，取最大值；彙整頁取它收錄的課程的最大值。
const courseLastmod = (c) => maxDate((c.sources ?? []).map((s) => s.lastVerifiedAt));
const listLastmod = (list) => maxDate(list.map(courseLastmod));

function entries(d) {
  const pages = [
    { rel: 'index.html', lastmod: d.home.updatedAt, changefreq: 'daily', priority: '1.0' },
    { rel: 'open.html', lastmod: listLastmod(d.openCourses), changefreq: 'daily', priority: '0.9' },
    { rel: 'types.html', lastmod: listLastmod(d.courses), changefreq: 'weekly', priority: '0.7' },
    ...d.types.map((k) => ({ rel: `type/${k.kind}.html`, lastmod: listLastmod(k.list), changefreq: 'weekly', priority: '0.7' })),
    { rel: 'topics.html', lastmod: listLastmod(d.courses), changefreq: 'weekly', priority: '0.8' },
    ...d.topics.map((t) => ({ rel: `topic/${t.name}.html`, lastmod: listLastmod(t.list), changefreq: 'weekly', priority: '0.7' })),
    { rel: 'cities.html', lastmod: listLastmod(d.courses), changefreq: 'weekly', priority: '0.7' },
    ...d.cities.map((c) => ({ rel: `city/${c.name}.html`, lastmod: listLastmod(c.list), changefreq: 'weekly', priority: '0.7' })),
    { rel: 'map.html', lastmod: d.home.updatedAt, changefreq: 'weekly', priority: '0.8' },
    { rel: 'teachers.html', lastmod: listLastmod(d.courses), changefreq: 'weekly', priority: '0.6' },
    { rel: 'search.html', lastmod: d.home.updatedAt, changefreq: 'monthly', priority: '0.6' },
  ];
  // 停開與已截止的課仍然收錄，只是 priority 低、changefreq 長（見 site/sitemap.mjs）
  const courses = d.courses.map((c) => ({
    rel: `course/${c.slug}.html`, lastmod: courseLastmod(c), ...courseHint(c.enrollment?.status),
  }));
  const venues = d.venuePages.map(({ venue, list }) => ({
    rel: `venue/${venue.slug}.html`, lastmod: listLastmod(list), changefreq: 'weekly', priority: '0.5',
  }));
  const teachers = d.teachers.map(({ teacher, list }) => ({
    rel: `teacher/${teacher.slug}.html`, lastmod: listLastmod(list), changefreq: 'weekly', priority: '0.5',
  }));
  return { pages, courses, venues, teachers };
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
          entries: list.filter((e) => existsSync(path.join(dist, e.rel))),
        }));
        const sitemap = await writeSitemaps({ dist, siteUrl: SITE_URL, groups });
        const counts = groups.map((g) => `${g.name} ${g.entries.length}`).join('、');
        logger.info(`sitemap：${sitemap.total} 個 URL（${counts}），分 ${sitemap.files.length} 檔 ＋ robots.txt`);
      },
    },
  };
}
