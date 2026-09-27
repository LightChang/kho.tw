// site/jsonld.mjs 的輸出直接丟進共用驗證器（vendor/seo-ops-jsonld）驗：
// 首頁不再帶 SearchAction、麵包屑符合 Google 規格且與可見麵包屑同一份資料。
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHtml, loadRules, loadSiteConfig } from '../vendor/seo-ops-jsonld/validate.mjs';
import { homeJsonLd, breadcrumbJsonLd, SITE_URL } from '../site/jsonld.mjs';
import { sectionCrumbs, underSection, underCity, learnCrumbs } from '../src/lib/crumbs.mjs';

const rules = await loadRules();
const site = await loadSiteConfig(new URL('../site/jsonld-pages.json', import.meta.url));
const html = (...objs) => `<!doctype html><head>${objs.map((o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`).join('')}</head>`;
const errorsOf = (page, ...objs) => validateHtml(html(...objs), { page, rules, site }).filter((i) => i.severity === 'error');

test('首頁：WebSite＋Organization、沒有 SearchAction，共用規則 0 錯誤', () => {
  const ld = homeJsonLd({ description: 'x' });
  assert.equal(JSON.stringify(ld).includes('SearchAction'), false);
  assert.deepEqual(errorsOf('/', ld), []);
});

test('首頁若把 SearchAction 加回來會被擋', () => {
  const ld = homeJsonLd();
  ld['@graph'][1].potentialAction = { '@type': 'SearchAction', target: `${SITE_URL}/search.html?q={q}` };
  assert.ok(errorsOf('/', ld).some((i) => i.code === 'removed-property'));
});

test('麵包屑：各頁型都符合 BreadcrumbList 規格', () => {
  const cities = new Set(['臺北市']);
  const cases = [
    ['/open.html', sectionCrumbs('open')],
    ['/types.html', sectionCrumbs('types')],
    ['/city/臺北市.html', underSection('cities', '臺北市')],
    ['/learn/*/*.html', learnCrumbs({ name: '瑜珈', label: '瑜珈' }, { city: '臺北市', district: '內湖區', cityArea: '臺北市' })],
    ['/venue/x.html', underCity('臺北市', '內湖運動中心', cities)],
    ['/venue/y.html', underCity('澎湖縣', '某地點', cities)],
  ];
  for (const [page, crumbs] of cases) {
    const ld = breadcrumbJsonLd(crumbs);
    const errs = validateHtml(html(ld), { page, rules }).filter((i) => i.severity === 'error');
    assert.deepEqual(errs, [], page);
    const items = ld.itemListElement;
    assert.equal(items.length, crumbs.length);
    assert.equal(items[0].item, `${SITE_URL}/`);
    assert.equal(items.at(-1).item, undefined, '最後一項是本頁');
    items.forEach((it, i) => assert.equal(it.name, crumbs[i].name));
  }
});

test('麵包屑網址與可見連結同源（百分比編碼一致）', () => {
  const crumbs = underCity('臺北市', '課', new Set(['臺北市']));
  const ld = breadcrumbJsonLd(crumbs);
  assert.equal(ld.itemListElement[2].item, `${SITE_URL}${crumbs[2].href}`);
  assert.match(crumbs[2].href, /^\/city\/%E8%87%BA/);
});

test('只有一項（首頁）不輸出麵包屑', () => {
  assert.equal(breadcrumbJsonLd([{ name: '首頁' }]), undefined);
  assert.equal(breadcrumbJsonLd(undefined), undefined);
});
