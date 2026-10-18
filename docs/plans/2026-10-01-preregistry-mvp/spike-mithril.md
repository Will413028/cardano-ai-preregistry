# Mithril v2 transaction proof spike

量測日期：2026-10-18，步驟 7b 子項 1。拋棄式程式碼在 `spikes/mithril/`（`node-probe.mjs`、`record-replay.mjs`、`web/`、`browser-run.mjs`）。只讀公開 preprod aggregator 與 Koios，不送交易、不用帳號。

## 結論

停止條件都沒有觸發：`@mithril-dev/mithril-client-wasm` 0.10.12 在 Vite 8 build 的頁面與 Node 22 都能取得並驗證 v2 transaction proof 與 certificate chain，preprod aggregator 可用。兩個發現要在子項 3 之前處理：

1. **preprod 與 preview 的 Mithril genesis verification key 相同**，只有 mainnet 不同。I9 寫的「公開網路的網路身分由寫死的該網路 genesis key 驗證」只能區分 mainnet 與測試網，不能區分 preprod 與 preview。已列為 D16。
2. **冷啟動的 certificate chain 驗證約 1 分鐘**（瀏覽器 59 秒），開啟 certificate 快取後第二次 0.5 秒。不阻塞主執行緒，但第一次核對要有進度提示。

## 版本與 API

| 項目 | 值 |
|---|---|
| 套件 | `@mithril-dev/mithril-client-wasm` 0.10.12（2026-10-16 發布；npm `latest` 仍為 0.10.8），Apache-2.0 |
| 載入 | 預設 export `initMithrilClient()`（web target 必須先呼叫），`new MithrilClient(aggregator, genesisVkey, options)` |
| unstable 開關 | `options.unstable: true`；v2 函式未開時不可用 |
| 快取開關 | `options.enable_certificate_chain_verification_cache: true`（unstable），存於 IndexedDB `mithril-client-certificate-cache`，同 origin 跨頁載入有效 |
| 取 proof | `get_cardano_transaction_v2_proof(hashes)` → `CardanoTransactionsProofsV2`：`certified_transactions[]`（`transaction_hash`、`block_number`、`slot_number`、`block_hash`）、`non_certified_transactions[]`、`certificate_hash`、`latest_block_number` |
| 驗 chain | `verify_certificate_chain(certificate_hash)` → 驗過的 certificate |
| 驗 proof | `verify_cardano_transaction_v2_proof_then_compute_message(proof, cert)` → message |
| 比對 root | `verify_message_match_certificate(message, cert)` → `true`／`false` |
| aggregator | `https://aggregator.release-preprod.api.mithril.network/aggregator`；capabilities 含 `CardanoBlocksTransactions`，`max_hashes_allowed_by_request` 100 |
| genesis key 來源 | `mithril-infra/configuration/<network>/genesis.vkey`（IntersectMBO/mithril `main`）；spike 下載到 `spikes/mithril/fixtures/`（被 `*.vkey` 規則忽略，重跑前先下載） |

`security_parameter` getter 在 0.10.12 回傳的值等於 `latest_block_number`（實測兩者皆 5304975），不可依賴；k 改用各網路的程式常數。

## 樣本結果

公開樣本 tx `694698814e8a01df5f635d19548d6177800389e3af480a9976f226ee3b12ec93`（Koios 的 block 5300000 第一筆，不是本產品交易）：certified，block 5300000、slot 136492696、block hash `925942612f9d…`，與 Koios `blocks` 的 `abs_slot` 相同。certificate 的 `signed_entity_type` 為 `CardanoBlocksTransactions [320, 5304975, 5]`。全零 hash 回在 `non_certified_transactions`，可直接對應「已上鏈、等待認證」或不存在（proof 本身不區分兩者，D15）。

| 環境 | init | 取 proof | chain 驗證 | proof＋root 比對 |
|---|---|---|---|---|
| Node 22，連網 | — | 1313 ms | 47812 ms | 55 ms |
| Node 22，離線重播 | — | — | 整體 27–37 秒（CPU） | — |
| Chromium headless，冷 | 176–425 ms | 996–1167 ms | 58974–59270 ms | 10–12 ms |
| Chromium，快取第一次 | 50 ms | 468 ms | 59634 ms | 1 ms |
| Chromium，快取已暖 | 20–23 ms | 454–478 ms | 499–500 ms | 0–1 ms |

chain 驗證共 127 個 request（1 個 proof＋126 張 certificate，回到 epoch 196 的 genesis certificate `69bc3bdfff0bb134675396e83b301f43e763d576d4b85856f6b3cb806af7ad59`）。驗證期間 50 ms 計時器的最大間隔 51–83 ms，不需要 Web Worker。

Vite 8.3.2 不加外掛即可 build：`mithril_client_wasm_bg.wasm` 2129.44 kB（gzip 762.25 kB），JS 36.62 kB（gzip 8.74 kB）。WASM 應延遲載入，只在核對時下載。

## 竄改測試（離線重播）

重播錄製的回應並在 `fetch` 層竄改（`node record-replay.mjs replay <tamper> <tx>`）：

| 竄改 | 結果 |
|---|---|
| 無 | `message_match true` |
| proof 內的 tx hash 換成同區塊另一筆 | `InvalidSetProof … MKMapProof does not contain leaf` |
| proof 的 slot +1 | `InvalidSetProof`（slot 在 leaf 內，被綁定） |
| chain 中段 certificate 的 `previous_hash` | `Certificate chain … is invalid` |
| leaf certificate 的 Merkle root message part | `Certificate chain … is invalid` |
| proof 指向 chain 中另一張有效 certificate（MithrilStakeDistribution epoch 320） | chain 驗過；`verify_message_match_certificate` 回 `false` |
| 同上但不呼叫 `verify_message_match_certificate` | 沒有錯誤——**`…then_compute_message` 本身不比對 root** |
| 用 preview 的 genesis key | `message_match true`（兩網路 key 相同） |

因此 adapter 必須呼叫 `verify_message_match_certificate` 並要求結果 `=== true`；回 `false` 不會丟例外。這就是步驟 7b mutation「略過 proof root 與已認證 message 的比對」要守住的點。

leaf certificate 的 `metadata.network`（本次 126 張皆為 `preprod`）參與 certificate hash 但不在多重簽章的 message 內，而 leaf 的 hash 只由 aggregator 提供的 `certificate_hash` 指向，所以這個欄位不能當網路身分的證據（讀 certificate 結構推論，未建造偽造 chain 實測）。

## 離線測試的做法

WASM 的 HTTP 走全域 `fetch`，所以不需要 `mithril-aggregator-fake`：測試以 stub 的 `fetch` 重播錄製檔，沒有對應錄製的 request 直接丟錯，即可保證不連外。兩個實作細節：

- 重播的 `Response` 要補 `url` 屬性（`Object.defineProperty(res, "url", …)`），否則 WASM 丟 `url parse`。
- 錄製檔約 785 kB；chain 驗證在 Node 下每次 27–37 秒。產品測試應每個 fixture 只驗一次 chain（`beforeAll`），竄改案例改竄 proof 或 leaf；或 adapter 先用未驗證的 certificate 做 proof 與 root 比對、最後才驗 chain，讓失敗案例在 1–2 秒內結束。錄製檔目前在 ignored 的 `spikes/mithril/local/`，子項 3 時精簡欄位後放進 `tests/fixtures/`。

## devnet

Yaci Store 的 `WebConfig` 對 `/api/**` 註冊 CORS（`allowedOriginPatterns`、`allowCredentials`、`maxAge`），瀏覽器應可跨來源直讀——這是讀 jar 內 class 常數的推論；Store 沒有 node 時不會起 HTTP，本輪未實測 header。devnet 沒有 Mithril，輸出依 I9 標「本機信任」；子項 6 的 E2E 會實測直讀。

## D16 的選項（交 Will）

- A：網路身分只用 genesis key 區分 mainnet 與測試網；preprod／preview 依交易 metadata 與 commitment preimage 內的網路欄位，輸出標「測試網，Mithril 不區分 preprod 與 preview」。取捨：零額外機制；兩個測試網可互相冒充，但都不承載價值。
- B：另外寫死各網路的 genesis certificate hash（preprod 目前為 `69bc3bdf…`），adapter 在 chain 驗證期間包住 `fetch`，確認走到的 genesis certificate 等於常數。取捨：可區分兩個測試網；依賴 WASM 走全域 `fetch` 的實作細節，且 Mithril re-genesis 時要更新常數並發版。
- 建議 A：I9 要防的是「testnet 被當成 mainnet」，A 用密碼學守住；B 的保護只在兩個無價值網路之間，卻增加 unstable 依賴。mainnet 上線前（D10 延後項）重新評估。

## 尚未驗收

快取在 Node／vitest 下是否可用；Firefox、Safari；行動裝置的冷啟動時間；Yaci CORS 的實際 header；mainnet aggregator（不需要，mainnet 延後）。
