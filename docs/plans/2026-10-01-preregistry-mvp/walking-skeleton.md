# 步驟 5：本機 Walking skeleton 驗收

日期：2026-10-01。此步是本機 fake-chain demo，沒有提交 Cardano v1
交易、CIP-30 簽署、真實 Koios adapter、完整 RevealBundle 或部署。

## 已落地

- Vite＋TypeScript 網頁，瀏覽器內 parse／schema／JCS／32-byte CSPRNG salt／SHA-256。
- `ChainWriter`／`ChainReader` 與 browser-memory `FakeChain`。
- 可注入 reader 的 `verify_reveal`：match、mismatch、not-found、invalid，核對公開期限並附驗證邊界。
- 私密 comparison draft 的本機下載；demo 重整會清除 fake-chain 紀錄。
- `/api/read` 的 body-free GET 查詢白名單、fixture source、bounded TTL cache 與同一 query 的 in-flight 去重。
- `.nvmrc`、精確套件版本與 npm lock、lint、TypeScript check、production build、Vitest、Playwright、GitHub Actions。
- `docs/commitment-v1.md`、11 組保存的選定 spike 向量與 4 組 Python 獨立產生的 v1 bytes/hash 向量。

Read proxy 目前只在 Vite dev server 提供 fixture，不連真實上游；static
production build 是 demo。狀態頁的增量索引、watermark、rollback 與 Koios
接線仍屬步驟 8。Mesh／CIP-30 真實交易屬步驟 6。

## 已跑驗收

Runtime：Node 22.23.3。從 repo 根目錄執行：

```sh
make check
make mutations
make integration
python3 docs/plans/2026-10-01-preregistry-mvp/check_plan.py docs/plans/2026-10-01-preregistry-mvp.md
```

| 檢查 | 結果 |
|---|---|
| ESLint、TypeScript、Vite build | 通過 |
| Vitest | 2 files，26 tests 通過 |
| Chromium e2e | 4 tests 通過 |
| `verifier-always-match` mutation | 原本能 match、變更設定後必 mismatch 的 e2e 失敗；mutation 被殺死 |
| `canonical-key-order` mutation | 已保存向量的 bytes/hash 斷言失敗；mutation 被殺死 |
| read-only Koios preprod smoke | 通過；查既有公開樣本，不是本產品交易 |
| 計畫 checker | 10 步、12 題決定、20 項需求通過 |
| 桌面／375px 手機 | 實際 Chromium 截圖檢視，無水平 overflow |

E2e 實際攔截 HTTP request 與 WebSocket frames；登記前輸入不同於 sample 的
私密 marker，確認請求不含它或 salt，public record 不含 manifest／salt。
另測草稿下載、第二次登記使用不同 salt、重整後找不到舊紀錄、duplicate
JSON key 被拒絕、proxy 拒絕私密查詢欄位與 POST。Unit 保護 unsafe number、
Unicode、網路分離、讀回期限 mismatch、不可變 fake records、cache 去重／
過期／bounded eviction／失敗重試與網路隔離。

兩項 mutation 已還原，再以 `make check` 跑乾淨版本。npm package／lockfile
欄位一致；`git ls-files --others --exclude-standard` 的 initial commit 候選
未包含依賴、本機 logs、金鑰、虛擬環境或 test output。私密測試資料只使用
合成 marker；test vectors 的 deterministic salt 為公開 fixture。

本機輸出在 ignored `spikes/chain/local/scaffold-*.log`；桌面與手機 screenshot
也留在同一 ignored local 目錄。Mac optional `fsevents` build 未完成，已中止
該 optional child，npm 正常完成；Vite fallback watcher 與驗收均可跑。
初次 TypeScript 7 與 parser peer range 不合，改用相容的 TypeScript 5.9.3，
不使用強制略過 peer dependency 的選項。

## CI 驗收與接手

Will 確認初始 commit／push 後，已再次核對帳號 `Will413028`、remote、
`main` 與遠端無其他分支，建立 `1cb5d5b`（`feat: add local preregistry walking skeleton`）
並正常 push。提交包含原有產品文件、計畫／spikes、MIT LICENSE，以及本步程式、測試與 CI。

[GitHub Actions run 36868041395](https://github.com/Will413028/cardano-ai-preregistry/actions/runs/36868041395)
的 `offline-check` 與每個 step 均成功：Linux／Node 22.23.3 的 npm ci、Chromium 安裝、
`make check`、`make mutations`。步驟 5 已完成；網路 smoke 僅本機跑，不是 CI 必要條件。

下一步依計畫進入步驟 6，實作真實測試網登記與 CIP-30；本 demo 尚未接入真實鏈。
ADR 仍待集中整理。未授權帳號註冊、真實金鑰、mainnet、部署或對外 CIP PR。
