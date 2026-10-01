# 步驟 6：測試網登記實作與驗收

目前進行中；只有本機、mutation、devnet integration 與 CI 全部通過才勾選完成。

## 產品路徑

保留明確的 local demo；真實登記是 prepare → 下載 private draft → CIP-30 sign → submit → 公開鏈讀回。
prepare 使用 manifest v1／既有格式與新 CSPRNG salt，取得所選網路的 protocol parameters，
確認 wallet input 存在於該網路，以 Mesh 建立只含白名單 metadata 的交易。
簽署前後核對 fee ≤300000 lovelace、body hash、metadata、testnet outputs 與 required signer。
簽署或送出失敗仍保留原 draft；可能已送出的交易不自動重送，依 prepared tx hash 查詢。
所有 prepare／sign／readback 使用互斥操作鎖，下載不會重新開放 signing。

原 fake ChainWriter.commit 立即回傳確認紀錄；真實鏈必須區分 prepared／submitted／confirmed，
由 prepare_registration、sign_and_submit 與 ChainReader 分別提供，不捏造確認 block_time。
公開 reads 共用 ReadProxy／MemoryReadCache／parse_public_query；/api/cardano 是 Vite transport adapter，
固定 devnet／preprod endpoints，拒絕 POST、body、重複或非白名單參數。

## label 與鏈上格式

暫用 private-use label 86741，並非 CIP 註冊或 mainnet 發布。
2026-10-01 查 [CIP-10 registry](https://raw.githubusercontent.com/cardano-foundation/CIPs/master/CIP-0010/registry.json)
與 [private-use 範圍](https://cips.cardano.org/cip/CIP-0010)，再實際跑：

```sh
curl -fsS 'https://preprod.koios.rest/api/v1/tx_by_metalabel?_label=86741&limit=1'
curl -fsS 'https://api.koios.rest/api/v1/tx_by_metalabel?_label=86741&limit=1'
```

兩者回傳 `[]`，僅表示本次抽樣查詢無紀錄，不保證專屬或永久無碰撞。reader 同時檢查 app、版本與 network。
metadata 欄位為 app、format_version、network、commitment_hash、reveal_deadline；hash 使用 64-byte lowercase hex text，
每個 text 都在 Cardano 64-byte 上限內。salt、manifest、私密 draft 不送上鏈或 server。

## 沿用盤點與審查

- v1 編碼／向量：I2 與已決 D5／D6 要求保留；不重寫 bytes framing。
- FakeChain：保留為隔離、離線教學／測試入口；不拿 fake record 當鏈上確認。
- 共用 read proxy：D9 要求；設計審查指出雙份 cache，已整合，後續步驟 8 實作索引來源。
- Mesh：D11 已決；真實 CBOR 測試驗證欄位、fee、signer 與 network。依官方 browser polyfill 指南提供相容性。
- funding profile：本步確定支援單一 ADA-only input，至少 3 testADA；保守門檻保證找零及費用空間，
  不花用其他 tokens，並限制 UTxO 核對為一次公開查詢。reader 接受同一 payment key 的 inputs；
  registrant 是實際花費 input 的 key，HD wallet change key 可不同。
  要支援 fragmented funds、multi-asset inputs 或多 payment keys 時，重新評估 coin selection／identity profile；
  仍必須維持 D10 fee cap 與明確 signer identity。
- 公開部署：本步只驗收本機 Vite API；部署 adapter 於發布步驟完成，不把 static dist 宣稱可提供 API。

獨立設計審查：2 findings，改 1、記 1、提 0、駁回 0。
獨立 correctness review：2 findings（HD key mismatch、await 期間互相覆寫）已修，新增回歸案例。
指令檔對帳：刪除 AGENTS.md 一處過期的「stack 未決」事實，產品與驗證邊界保留。

## 驗收結果

lint、TypeScript/build、39 個 unit tests 通過；6 個 Chromium E2E 以單 worker 全數通過。
本機 4 workers 重跑時錢包情境耗盡整段 30 秒；單 worker 同一情境 9 秒通過，未放寬 timeout。
5 個 mutation 全部被 behavioral assertions 抓到。devnet 真實送出／讀回與 CI 仍待驗收。

## 重新執行 integration

需已啟動本機 magic-42 Yaci 節點與 Store、已授權的 ignored devnet 測試金鑰及 tADA。
所有啟動 logs 都留 ignored local 目錄，避免工具內建 devnet key 被印到公開輸出。

```sh
PREREGISTRY_DEVNET=1 make integration
```

沒有 opt-in 時 make integration 保持 read-only Koios smoke；CI 不送鏈上交易。
preprod 真實瀏覽器 extension 簽署與公網 finality 未測；devnet CLI wallet adapter 與合成 CIP-30 fixture 分開記錄。
