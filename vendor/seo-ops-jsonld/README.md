# seo-ops-jsonld（vendor 副本，勿直接改）

四站共用的 JSON-LD 規則檔與驗證器，原樣複製自 seo-ops repo 的 `jsonld/`。

| 檔案 | 來源 |
|---|---|
| `rules.json` | `seo-ops@057f8b2:jsonld/rules.json`（官方文件查證結果，2026-09-27） |
| `validate.mjs` | `seo-ops@057f8b2:jsonld/validate.mjs` |
| `validate.test.mjs` | `seo-ops@057f8b2:jsonld/validate.test.mjs`（`pnpm test` 會跑） |

來源 commit：`057f8b25ac40c26f0a76d31cffbded125a722d38`（2026-09-27）。
查證紀錄與每季複查步驟在上游 `/mnt/yao-care/seo-ops/jsonld/README.md`，不在這裡重抄。

為什麼用複製而不是直接引用 `/mnt/yao-care/seo-ops`：建置與驗證要能在任何 clone 上跑，
不能依賴主機上另一個 repo 的路徑。

本站怎麼用：`site/validate-jsonld.mjs` 呼叫這裡的 `validateHtml()`，頁型要求寫在 `site/jsonld-pages.json`。

## 同步

上游有新 commit 時（每季複查、或上游 README 的查證紀錄新增一列）：

```sh
REV=<上游新 commit>
for f in validate.mjs rules.json validate.test.mjs; do
  git -C /mnt/yao-care/seo-ops show "$REV:jsonld/$f" > vendor/seo-ops-jsonld/$f
done
node --test vendor/seo-ops-jsonld/validate.test.mjs
node site/validate-jsonld.mjs          # 需要已建置的 dist/
```

然後更新本檔的來源 commit，三個檔案與本檔同一個 commit 提交。
要改規則就改上游再同步回來；本站專屬的要求寫在 `site/jsonld-pages.json` 或 `site/validate-jsonld.mjs`。
