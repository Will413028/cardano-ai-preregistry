# 步驟 7b：信任模型的實作與驗收

## 產品路徑

讀者不再信任任何 API 回傳的解析結果。所有讀取都先取得交易的原始 CBOR（Koios `tx_cbor`、可選的開發快取、本機保存的已簽交易），再自己核對：body bytes 的 hash 等於 tx hash、metadata 的 hash 等於 body 內的 auxiliary data hash、`required_signers` 恰好一把 key 且其 vkey witness 有效（這把 key 就是登記者）、交易不含任何能執行 script 的欄位。上鏈與時間來自 reader 的信任根：preprod 用 Mithril v2 transaction proof 對寫死的 genesis key 驗 certificate chain，時間由認證的 slot 以程式常數換算；devnet 由本機 indexer 確認，標「本機信任」；local demo 以公開的 demo key 簽出真實格式的交易，標「不是鏈上證據」。

新登記用格式 v2：登記者 payment key hash 參與 commitment hash，別的 key 複製 commitment 也核對不成 match。v1 的 devnet 舊交易仍可核對，結果標明未綁定登記者。揭露包與檔案可以從 URL 或使用者上傳取得，一律以 hash 核對。

規格見 [commitment v2](../../commitment-v2.md)；spike 見 [spike-mithril.md](spike-mithril.md)。

## 設計選擇

| 題目 | 選擇 | 理由 | 捨棄 |
|---|---|---|---|
| CBOR 解析 | 自寫最小 CBOR reader（`src/cbor.ts`），保留每個頂層元素的原始 byte 範圍 | tx hash 必須對原始 body bytes 算；獨立 verifier 不依賴建交易用的函式庫（Mesh）重新序列化 | 用 Mesh／cardano-js-sdk 解析：要依賴其「保留原始 bytes」的實作細節，且與寫入端共用同一套程式，失去獨立性 |
| 簽章與 hash 函式庫 | `@noble/curves` 1.9.7（Ed25519，strict RFC 8032）、`@noble/hashes` 1.8.0（BLAKE2b） | 已是既有的間接相依（`bip39`），純 JS、可在瀏覽器與 Node 跑 | libsodium：WASM 載入與體積較大 |
| 交易白名單 | body 只允許 key 0、1、2、3、7、8、14、15；witness set 只允許 0、2；`is_valid` 必須為 true；auxiliary data 不可含 script | 計畫要求拒絕 script、redeemer、collateral；用白名單比黑名單少漏（mint、certificate、withdrawal、reference input 都可能引入 script 執行） | 只擋 redeemer 與 collateral：native script 與 reference script 仍可能出現 |
| Mithril 驗證順序 | 先用未驗證的 leaf certificate 比對 proof 與 Merkle root，失敗就提早結束；再驗 chain，最後用已驗證的 certificate 再比對一次 | 竄改的 proof 不必等約 1 分鐘的 chain 驗證；最終判定只依已驗證的 certificate | 只在驗完 chain 後比對：結果相同但失敗案例慢 |
| certificate 快取 | 瀏覽器開 WASM 的 IndexedDB 快取；同一 `MithrilInclusion` 實例另以記憶體記住已驗證的 certificate hash | 冷啟動 chain 驗證約 1 分鐘（spike 實測），一次公告核對要驗兩筆交易 | 每次重驗：每次核對 2 分鐘以上 |
| devnet 的交易 bytes | 使用本 tab 或 integration 腳本送出的已簽交易；Yaci 只用來確認上鏈與取時間 | Yaci Store 0.1.0 沒有 CBOR 端點、也不存 CBOR（讀 jar 內的 controller 與設定確認）；bytes 反正以 hash 自驗，來源不影響結果 | 換 indexer：超出本步範圍 |
| 錯誤模型 | 新增 `unavailable`：傳輸可能造成的失敗（bytes 對不上 hash、metadata 或 witness 被改、來源失效、proof 驗不過）；`invalid` 只給 hash 綁定的 body 本身不是 app 交易 | I4：換一個壞掉或說謊的來源，不能把真的 match 變成「宣稱不成立」（設計審查） | 全部收成 `invalid`：沿用自信任 JSON 的時代 |
| 時間的位置 | 只在 inclusion：certified 由 slot 換算，local 由本機 indexer 或 demo 給 | 傳輸不被信任，型別上就不讓它提供時間（設計審查） | 傳輸型別帶 `reported_time` 再由 verifier 忽略：只靠 mutation 守住 |
| 送出前的檢查 | 已簽交易先跑 `verify_transaction`，必須證明出同一個登記者才送出 | 讀取端會拒絕的交易一旦上鏈就永久無法核對（設計審查） | 只看 witness：錢包或 Mesh 加入白名單外的欄位時會漏掉 |
| 開發快取 | `/api/cardano` 只在 Vite dev server 存在，網頁的選項只在 dev 顯示 | build 出的網站沒有伺服器；整套去留延到步驟 8（見計畫「延後」） | 正式 UI 也提供：static build 選了一定失敗 |
| 網路身分（D16=A） | genesis key 只區分 mainnet 與測試網；preprod／preview 依 metadata 與 hash 內的網路欄位 | 兩個測試網共用 genesis key（spike 實測） | 釘 genesis certificate hash：依賴 WASM 實作細節，re-genesis 要發版 |

## 驗收結果

- `make check`（Node 22.23.3）：lint、TypeScript／build、10 個 unit 檔、9 個 Chromium E2E 通過（數量與 CI 結果見進度表）。
- 對抗測試（`tests/unit/trust.test.ts`、`transaction.test.ts`、`mithril.test.ts`、`mithril-genesis.test.ts`）：
  - 別的 key 複製同一 `commitment_hash` 登記，並用已公開的 manifest 與 salt 發公告：公告與揭露包核對都是 `mismatch`；同一測試裡原登記者的公告是 `match`。
  - reader 回傳別筆交易的 bytes、改 metadata 但 body 不變（auxiliary data hash 不符，在真實 devnet 交易上測）、witness 被移除、witness set 含 script：`unavailable`。來源失效或 Mithril proof 驗不過：`unavailable`。
  - witness 簽章翻一個 bit、簽章來自非 required signer 的 key：`verify_transaction` 拒絕（歸為來源錯誤）。
  - `required_signers` 為 0 或 2 把、body 含 collateral：`invalid`；`is_valid=false` 與兩筆真實 preprod Plutus 交易也被拒。
  - 不認得的 inclusion（例如 `status: local` 配 `trust: mithril`）：拒絕，不當成本機信任。
  - Mithril：proof 的 leaf 改名成另一筆 tx、proof 指向 chain 中另一張有效但簽的不是交易 root 的 certificate、chain 中段斷裂、preprod 資料冒充 mainnet（不同 genesis key）：都拒絕；未認證的交易回 `pending`；未設定信任根的網路直接拒絕。
  - 已認證交易的時間等於 slot 換算值（`2026-10-16T18:38:16.000Z`，與 Koios 對同一 slot 回報的時間相同）；傳輸型別沒有時間欄位。
  - 揭露包與檔案從上傳取得、URL 全部失效：`match`；上傳了不相符的檔案則仍去試 URL。
  - 經開發快取與直連 Koios 取得相同 bytes：兩個核對結果完全相同。
  - 公告的手續費 input 屬於另一把 key（兩個 witness）：可核對，身分仍是 required signer。
  - 公告由別的 key 簽：`signer-mismatch`，結果同時列出公告簽署者與 commitment 登記者。
  - 寫入端：新登記用 v1 格式、已簽交易無法通過 `verify_transaction`、錢包沒用登記者 key 簽：都不送出。
  - local-node 信任用在 devnet 以外的網路：拒絕。
  - 步驟 7 的兩筆真實 v1 devnet 交易：`match`，標明未綁定登記者與本機信任；以 v2 草稿核對則 `invalid`。
- E2E：
  - devnet 全流程用會真正簽章的 mock CIP-30 錢包（Node 端以 Ed25519 簽），走預設的直連路徑（protocol parameters、UTxO、讀回都直連 Yaci，route 回放錄下的真實 Yaci 回應形狀，全程沒有 `/api/cardano` request）：登記 → 讀回並自驗→ 建揭露包 → 公告準備（未託管、內容不符、錢包登記者 key 不同都擋下）→ 拒簽不重送 → 簽署送出 → 核對公告 `match`、標本機信任 → 揭露包 URL 失效為 `files-unavailable`，上傳揭露包後 `match`；375px 沒有橫向 overflow；request 不含 salt 與 manifest 標題。
  - preprod 預設直連 Koios（不經 `/api/cardano`），切到開發快取得到相同結果。
  - local demo：輸出標「not chain evidence」；URL 全部失效後，上傳揭露包與檔案仍 `match`。
  - `/api/cardano` 拒絕舊的解析紀錄查詢（`kind=commitment`）。
- 14 個 mutation 全數被抓到；既有 8 個改到新的原始碼位置，新增 6 個：
  - `witness-signature-skipped`：被「無效或缺少 witness」測試抓到。
  - `registrant-not-in-preimage`：被「複製 commitment」測試抓到。
  - `certificate-chain-unverified`：被「斷裂 chain」測試抓到。
  - `time-not-from-slot`：被「slot 換算」測試抓到。
  - `proof-root-unchecked`：被「root 不在已認證 message」測試抓到。
  - `scripts-accepted`：被「含 script 的交易」測試抓到。
- `make integration`（預設，live、唯讀）：對公開樣本 tx `69469881…`，Koios bytes 的 body hash 相符、vkey witness 1/1 有效、app 規則依預期拒絕（Plutus 交易）、Mithril 認證 block 5300000、slot 136492696，slot 換算時間等於 Koios 的 `tx_timestamp`；Mithril 驗證 52 秒。
- [真實 devnet 結果](trust-results.json)（格式 v2，新 cluster `step7b2`）：
  - 登記 tx `82c267d48cbdef1631a20ad4095727b56a1a9d9f724e047462abc22f2e47702c`，fee 176413 lovelace；讀回自驗 `match`，登記者綁定，本機信任。
  - 公告 tx `a8831e539613d9d99334d7ab3928ace1515922ad4e334633b171c96e8d5ca94c`，fee 186269 lovelace（低於 300000）；URL 分 3 段。核對 `match`，簽署者等於登記者；換檔 `mismatch`，移除揭露包 `files-unavailable`，改由呼叫端提供揭露包 `match`。
  - 簽署用本機 CLI test key，不是瀏覽器 extension；devnet 的區塊時間來自該 devnet 的 genesis 設定，不對應牆鐘（例如公告時間 2026-10-17T19:25:59Z）。
- 瀏覽器內的產品 Mithril adapter（`src/mithril.ts`，經 Vite dev server 在 Chromium 載入）對 live preprod 驗證樣本 tx：冷啟動 63 秒，reload 後走 IndexedDB 快取 1.2 秒；結果都是 certified、slot 136492696。這是一次性的手動實測，沒有放進自動化測試。

## 審查

兩個未參與實作的唯讀 subagent：correctness review（不給 implementer summary）回 0 HIGH、3 MED、7 LOW；design-review 回 8 項（A 4、B 3、C 1）。處理如下。

- 已修：
  - MED-1 Mithril 已驗證 certificate 的記憶體快取只以 certificate hash 為 key，跨網路共用 instance 時可略過另一把 genesis key：改以網路＋hash 為 key。
  - MED-2 預設的直連寫入路徑沒有測試：devnet E2E 改走直連（見上）。preprod 的 `KoiosProvider` 寫入讀取仍只在真實錢包驗收時才會走到。
  - MED-3 本文件未進版控、進度表過期：一併提交並更新進度表。
  - LOW-1 script 白名單的文件說法過寬：v2 文件改寫，註明「被花掉的 input 自帶 reference script」從交易 bytes 看不出來，且不影響登記者身分。
  - LOW-2 signer-mismatch 看不到公告簽署者：新增 `announcement_signer` 並在網頁顯示。
  - LOW-3 讀回後的紀錄少了 commitment 欄位：補回 payload 欄位。
  - LOW-4 v1 文件刪掉的兩句邊界與隱私說明：搬回 v2 文件。
  - LOW-5 不認得的 inclusion 被當本機信任：改為明確比對，其他一律拒絕。
  - LOW-6／設計 C k 常數：計畫改寫成結論（本步不需要 k，認證不等於不可逆，步驟 8 自訂深度）。
  - LOW-7 WASM 載入失敗後永久失敗：失敗時清掉快取的 promise，可重試。
  - 設計 A 錯誤模型、B 時間放在傳輸型別、B/A 寫入端沒套用讀取政策、A 正式 UI 的 proxy 選項：見上方「設計選擇」新增的四列。
  - 設計 A v1 相容：保留 v1 驗證（計畫「不能動」，Will 已定），寫入端與 FakeChain 改為只接受 v2。
  - 設計 A mainnet 常數：保留，註解改為實際用途（沒有 app 路徑走到，釘住 mainnet 主張要對哪把 key；測試證明 preprod 資料過不了）。
- 記錄並附觸發條件（計畫「延後」）：devnet 交易 bytes 只在送出的 tab／腳本；`/api/cardano` 整套去留。
- 駁回：無。

## 未驗收

- preprod 真實瀏覽器 extension：CIP-30 錢包對 `required_signers` 的簽署行為、stake key 作為身分的可行性（D14），與步驟 6、7 的未驗收項相同，需要 Will 的錢包。
- preprod 上的 app 交易：尚未送過；所以「Koios bytes＋Mithril proof＋app 規則全部通過」的組合只在單元測試以組件分別驗證，沒有一筆真實 preprod app 交易走完。
- 瀏覽器內 Mithril 驗證的自動化：無法為 app 交易產生真的 proof，E2E 只涵蓋 devnet 與 Koios 直連；瀏覽器路徑由上面的手動實測與 spike 支持。
- Firefox、Safari 與行動裝置的冷啟動時間。

## 重新執行 integration

本機 devnet 用新的 node 名稱，不覆寫舊 cluster。本次觀察到一次：Yaci Store 0.1.0 在 `--epoch-length 60` 建立的 node 上，從 slot 600 起回報 block parsing error 並停止同步；改用預設 epoch 長度的新 node（`step7b2`）後正常，原因未查：

```sh
# 在 container 內的 yaci-cli：create-node -n <新名稱> --start
# Yaci Store 指向新 node：--store.cardano.n2c-node-socket-path=/clusters/nodes/<新名稱>/node/node.sock，並用新的 H2 檔
# topup ignored 的測試金鑰地址後：
PREREGISTRY_DEVNET=1 PREREGISTRY_DEVNET_SOCKET=/clusters/nodes/<新名稱>/node/node.sock make integration
```

腳本只寫 `trust-results.json`；步驟 6、7 的結果檔保持原紀錄。
