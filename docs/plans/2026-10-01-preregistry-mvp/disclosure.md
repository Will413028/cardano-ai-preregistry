# 步驟 7：揭露與獨立核對的實作與驗收

## 產品路徑

登記之後的流程：在瀏覽器裡用 private draft、結果與選定的檔案建立揭露包；檔案 hash 在本機計算，不上傳任何內容。
登記者自行託管揭露包與檔案（D7=A），再用原登記錢包 key 簽一筆鏈上揭露公告。
讀者有兩種核對方式：直接核對揭露包，或從公告的 tx hash 開始核對。後者依序檢查簽署者、揭露包 hash、commitment 與各檔案 hash。
local demo 的公告由 FakeChain 產生，不是鏈上證據。

格式見 [commitment v1](../../commitment-v1.md) 的 Reveal bundle v1 與 Disclosure announcement v1。

## 設計選擇

| 題目 | 選擇 | 理由 | 捨棄 |
|---|---|---|---|
| 公告的 label | 沿用 86741，以 `kind: 'reveal'` 區分 | D12 只暫用一個 private-use label；已上 devnet 的 v1 commitment payload 不改（格式版本規則） | 另選 label：碰撞查詢要重做，步驟 8 索引要掃兩個 label |
| URL 編碼 | 每段 64 bytes 的 ASCII text 陣列，除最後一段外都必須是滿的，最多 8 段（512 bytes） | Cardano metadata text 每段上限 64 bytes；規定「除最後一段外必須滿」讓每個 URL 只有一種編碼 | bytes 型 metadata：provider 回應形狀不一致（spike 已見 `0x` 前綴） |
| 結果欄位 | `results[]`：`experiment_id`、`completed_runs`、`metrics` | 讓「結果」有固定位置，又不預設評分語意 | 自由 JSON：讀者無法對應到 manifest 的實驗 |
| 網路宣稱 | 揭露包可以宣稱 mainnet／preview；commitment 仍只存在於 preprod／devnet | 要讓 testnet 冒充 mainnet 的情境能明確回報 `network-mismatch`，而不是籠統的 `invalid` | 只接受支援的網路：冒充情境無法表達 |
| 檔案取得 | `FileFetcher` 由呼叫端注入；網頁直接向檔案 URL 發 `fetch`（不帶 credentials、不帶 referrer） | I4：不經營運者的 read route | 經 `/api/cardano` 代抓：營運者會成為驗證的依賴 |
| 公告的 input | 只花用原登記者 payment key 的 input | D8：公告必須由同一登記者身分簽署；registrant 依 input key 推導 | 任選最大 input：HD wallet 可能選到別的 key |
| 公告前的核對 | 準備公告前從 URL 讀回揭露包，比對 hash，並用該網路的 reader 對 bundle 與每個檔案跑 `verify_reveal`，必須是 match | 公告上鏈後不可撤回；URL 打錯或尚未託管就送出，只會留下核對不過的永久紀錄 | 只檢查 URL 格式 |
| loopback http | 只有 devnet 的 bundle 與公告可用 `http://127.0.0.1`／`localhost` | 本機 devnet integration 需要；在公開網路上，會讓每位核對者的瀏覽器向自己的 localhost 發 request | 所有網路都允許 |

`verify_reveal` 只依賴揭露包、`ChainReader` 與檔案 URL。舊的 draft 核對改名為 `verify_commitment`，仍供登記讀回使用。
只核對揭露包時，內嵌的 results 沒有任何 hash 保護；輸出會明講，只有公告能固定它們。
按期／逾期與狀態屬步驟 8，本步只輸出公告區塊時間。

## 驗收結果

- `make check`（Node 22.23.3）：lint、TypeScript／build、66 unit、8 Chromium E2E 全數通過；[Linux CI](https://github.com/Will413028/cardano-ai-preregistry/actions/runs/39063030487)（commit `575f2cb`）的 `make check` 與 `make mutations` 也全數通過。
- 對抗測試（`tests/unit/disclosure.test.ts`）：
  - 竄改 manifest 一個欄位或換 salt：`mismatch`。
  - 換檔：`mismatch`，該檔標 mismatch。
  - 檔案取不到或被 CORS 擋：`files-unavailable`。
  - 指向另一筆 commitment：`mismatch`。
  - testnet 宣稱為 mainnet：`network-mismatch`（只以 tx hash 查詢的 reader）或 `not-found`。
  - 偽造公告簽署者：`signer-mismatch`。
  - 公告後修改揭露包：`mismatch`；揭露包被移除：`files-unavailable`；揭露包指向別筆 commitment：`mismatch`。
- 錢包 E2E（mock CIP-30＋真實 Mesh build）：非原登記者 key 的 wallet 被拒；公告欄位只有白名單，URL 分 2 段；簽署被拒後不送出、不重送，按鈕保持停用；request 不含 salt 與 manifest 標題。
- E2E：local demo 走完登記、揭露包、選檔與 URL、下載、託管（Playwright route）、公告、核對公告，得 `match`；換檔得 `mismatch`，刪檔得 `files-unavailable`，改揭露包得 `mismatch`；375px 沒有橫向 overflow。揭露前的 request 不含 manifest 與 salt（原 I3 測試保留）。
- 8 個 mutation 全數被抓到，新增 3 個：
  - `verifier-skips-file-hash`：被「換檔」測試抓到。
  - `verifier-ignores-network`：被「testnet 冒充 mainnet」測試抓到。
  - `boundary-removed`：被驗證邊界 inline snapshot 抓到。
- [真實 devnet 結果](disclosure-results.json)：
  - 登記 tx `8bc48e29a3ccc4afc989396424e75ab7074aa29e580d41128b46493b161c9cf7`，fee 176413 lovelace。
  - 公告 tx `f543976609247ac1980506b3dbe36576028328e79e34a8e5535961f7bc6eff50`，fee 186269 lovelace（低於 300000）；URL 分成 3 段經真實 node 與 Yaci Store 讀回。
  - `verify_announcement` 以 Yaci reader 與 loopback 託管核對得 `match`，登記者一致；換檔得 `mismatch`，移除揭露包得 `files-unavailable`。
  - 簽署用本機 CLI test key，不是瀏覽器 extension；檔案託管在 loopback http，跑完即關閉。
- `make integration`（預設）：read-only Koios preprod smoke，加上用公開樣本 tx 跑 Koios `read_commitment`／`read_announcement`，兩者都正確回 null（該 tx 不帶 label 86741，所以只驗到 `tx_info` 查詢與 label 篩選，沒驗到 preprod 上的 app 紀錄解析）。

## 審查

獨立 correctness review（不給 implementer summary）：0 HIGH、2 MED、5 LOW，處理如下。
- 已修並補回歸測試（每項都先確認舊程式失敗）：
  - 公告前不核對託管內容。
  - `verify_announcement` 未比對 reader 回傳的 tx hash。
  - loopback URL 不分網路一律接受。
  - `join_url` 接受單一超長段。
  - Koios reader 沒有 integration。
  - README 與進度表未更新。
- 未修，交 repo 擁有者決定：網頁的鏈上讀取經過同源 read proxy，registrant 也在 proxy 推導，所以這條讀取路徑仍依賴營運者服務。這是 D9（同源 proxy）與 I4 的張力。`verify_reveal`／`verify_announcement` 本身只依賴注入的 reader，網頁已加說明。

## 未驗收

- preprod 真實瀏覽器 extension 簽署公告與公網 finality：與步驟 6 相同，未測。
- 公開 https 託管與實際 CORS：只用 Playwright route 與 loopback 模擬；跨來源託管是否允許讀取，取決於登記者的主機。
- Koios 對 preprod 上真實 app 公告的解析：preprod 還沒有 app 交易。
- 網頁錢包公告的成功送出：mock CIP-30 只測到簽署被拒為止；成功送出只在 devnet 以 CLI test key 驗過。

## 重新執行 integration

本機 devnet 依 [spike-chain.md](spike-chain.md) 啟動，用新的空 cluster 目錄（本次為 ignored 的 `spikes/chain/local/clusters-step7`），topup ignored 測試金鑰後執行：

```sh
PREREGISTRY_DEVNET=1 make integration
```

腳本只會寫 `disclosure-results.json`，step 6 的 `registration-results.json` 保持原紀錄。
