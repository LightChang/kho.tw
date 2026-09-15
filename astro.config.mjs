import { defineConfig } from 'astro/config';
import khoSitemap from './src/lib/sitemap-integration.mjs';
import { SITE_URL } from './site/jsonld.mjs';

export default defineConfig({
  // canonical、sitemap 與 JSON-LD 全站都吃這個值，由 KHO_SITE_URL 覆寫（見 site/jsonld.mjs）
  site: SITE_URL,
  // 網址維持 /course/<slug>.html：slug 登記簿（data/slugs.ndjson）保證網址穩定，
  // 已經進 sitemap 與搜尋引擎的網址不能因為換框架而變成 /course/<slug>/。
  build: { format: 'file', inlineStylesheets: 'never' },
  trailingSlash: 'ignore',
  integrations: [khoSitemap()],
  vite: {
    build: { chunkSizeWarningLimit: 2000 },
  },
});
