# Spike：metadata commitment 的大小、費用與讀回

2026-10-01。僅測本機 devnet，未連 preprod／mainnet、未使用真實 ADA、未建立產品合約。D3、D4、D10、D12 仍待 Will 拍板。

## 實測結果

| 項目 | 結果 |
|---|---|
| 資料來源 | 本機 Cardano node＋Yaci Store HTTP API |
| 網路 | devnet，magic＝42；Conway；slot length＝1 秒、epoch length＝60 slots，僅供本機測試 |
| 工具 | Yaci DevKit 0.10.6，ARM64；Cardano CLI 10.1.1.0；附帶的 Java Store jar；Java 21.0.7；Python 3.13.13、cbor2 5.8.0 |
| Docker image digest | `bloxbean/yaci-cli@sha256:054643c8a2b6610c40beee492505344e87761860ef60c3abadd02102fac06a03` |
| commitment tx id | `8c2afcfadea9721506a6edd08f305a7024e78c1537429c9a6b6826a1d385818a` |
| metadata | 暫用 label `123456789`；app domain、32-byte hash、版本 0、network、magic；無 manifest／salt |
| signed transaction size | **348 bytes**，直接由 signed CBOR hex 長度換算，非 JSON 檔案大小 |
| 實付 fee | **175,269 lovelace＝0.175269 測試 ADA**，由 signed transaction body 的 fee 欄位解碼 |
| 本機包含時間 | **2.825 秒**，送出開始至 UTxO 查到此 tx id 的 output；不是公網 finality 量測 |
| metadata 讀回時間 | **3.341 秒**，送出開始至 indexer 可讀 metadata 並比對 hash；含輪詢與查詢開銷 |
| 比對結果 | 讀回 hash＝送出 hash，32 bytes 完全相同 |

完整機械證據：`chain-results.json`（tx info、metadata 原始回應、tips、CLI 版本及量測）、`chain-protocol-parameters.json`（當次 protocol parameters）。本機測試鏈資料與金鑰不進 repo，因此這個 tx id 不會出現在公網 explorer。

本次 commitment 是專供大小與費用量測的測試 hash，沒有預先選定 D5／D6 的正式產品格式；版本 0 與 label 都不是 v1 或 mainnet 的決定。

## 與 E1 公式比較

當次查詢 `txFeePerByte＝44`、`txFeeFixed＝155381`、`maxTxSize＝16384`。

```text
linear minimum = 44 × 348 + 155381 = 170693 lovelace
actual fee     = 175269 lovelace
difference     =   4576 lovelace
```

Cardano CLI `transaction build` 的實付 fee 高於按最終 signed bytes 計算的線性 minimum；本次沒有 validator execution fee。不能把自動建構工具的 fee 視為「剛好等於 minimum」。CLI 的 `calculate-min-fee --witness-count 1` 另回 `170649 Lovelace`，與 348-byte 公式相差 44 lovelace（1 byte）；此 CLI 估算與完整 signed CBOR 的計數差異尚未研究，不拿它替代實付欄位或完整 bytes 公式。

E1 原本的 350–600 bytes／約 0.17–0.18 ADA 是估算；本次 348 bytes／0.175269 測試 ADA 在量級上相符，但交易欄位、witness 數、UTxO 配置與 protocol parameters 改變時須重測。主網費用與確認時間均未量測。

## D3 選項 B／C 的成本比較（推估，不是合約實測）

| 方案 | 大小與費用能確認的部分 | 未量測的部分／取捨 |
|---|---|---|
| A 單筆 metadata | 已實測 348 bytes／175269 lovelace；提交階段不執行 validator | 格式合法性與揭露狀態由 verifier／registry 檢查 |
| B validator＋datum | 32-byte hash 本身仍很小；但需要 script address output、datum 與日後 spending/redeemer/witness。以本次參數，額外 100／500／2000 bytes 的線性 fee 增量為 4400／22000／88000 lovelace；這是大小敏感度，不是聲稱合約大小 | 合約、datum schema、reference script 策略與 ex-units 未定，故總大小／總費用不能給可靠單值。花費 script UTxO 時還有 `ceil(priceMemory × memory + priceSteps × steps)`；當次單價為 0.0577、0.0000721。建立 UTxO 需滿足最低 lovelace；參數 `utxoCostPerByte＝4310`，實際鎖定量需在確定 output bytes 後計算。鎖定本金可依合約解鎖，不能全部算成 fee |
| C 批次 Merkle root | 如果只把同長度 32-byte root 放到相同 metadata payload、相同交易拓撲，鏈上大小可維持約本次 348 bytes；以本次實付 fee 攤提，10／100／1000 筆約 0.0175269／0.00175269／0.000175269 測試 ADA／筆 | 此推估不含 batch size、proof URL 等額外欄位，也不含 proof 保存／服務成本；未送實際 batch 交易。登記時間由 aggregator 的提交時點決定，使用者需取得 inclusion proof |

合約能約束自身揭露／終止轉移；它不因此證明外部實驗執行或結果真實。根據目前需求，A 的實測成本與簡單性支持先採 metadata；選 B 時要把步驟 6 拆成合約與鏈下子步驟；選 C 時要補 aggregator 與 proof 取得／保存契約。

## 重現與核對

下列是本次實際使用的組件與命令。先按 `spike-canonical.md` 安裝並固定 Python 環境。所有指令由 repo 根目錄執行；下載、測試金鑰、devnet 目錄已於本 session 取得授權。

1. 先確認本機資料與金鑰忽略規則：

   ```sh
   git check-ignore -v spikes/chain/local/work/keys/payment.skey spikes/chain/local/work/keys/payment.vkey
   ```

2. 下載並解開 [Yaci DevKit 0.10.6](https://github.com/bloxbean/yaci-devkit/releases/tag/v0.10.6)，放在 `spikes/chain/local/`；pull 上表 digest。實際使用的 distribution 為 `yaci-devkit-0.10.6.zip`。

3. 建立本機容器（需沒有同名容器；不自動刪除已有狀態）：

   ```sh
   REPO_ROOT=$(git rev-parse --show-toplevel)
   docker run -d --name codex-cardano-preregistry-stable --cpus=4 --memory=3g \
     -p 127.0.0.1:18080:8080 -p 127.0.0.1:19000:10000 \
     --env yaci_cli_mode=native --env yaci_store_enabled=true \
     --env ogmios_enabled=false --env kupo_enabled=false --env yaci_store_mode=native \
     -v "$REPO_ROOT/spikes/chain/local/clusters-stable:/clusters" \
     -v "$REPO_ROOT/spikes/chain/local/work:/work" \
     -v "$REPO_ROOT/spikes/chain/local/yaci-devkit-0.10.6/config/node.properties:/app/config/node.properties" \
     --entrypoint sleep \
     bloxbean/yaci-cli@sha256:054643c8a2b6610c40beee492505344e87761860ef60c3abadd02102fac06a03 infinity
   ```

4. 啟動 CLI，輸入 `create-node -o --start --epoch-length 60`。本次將整份啟動輸出導到忽略的 `local/devnet-stable-start.log`，因為工具會印出內建 devnet 測試金鑰；不得把啟動 log 直接複製到公開文件。

5. 本次 native Store 未完成啟動。透過容器內 `ps -eo pid,comm` 核對 `yaci-store` 的 PID，只停止此容器中的該程序（本次 PID 289）。然後在獨立空資料庫啟動附帶 Java jar，以下最終命令已實際成功；不能共用 native 的 migration history，也不能省略 magic 42：

   ```sh
   docker exec -d codex-cardano-preregistry-stable sh -c \
     'cd /app/store && java -Xmx768m -jar yaci-store.jar --store.cardano.protocol-magic=42 --spring.datasource.url="jdbc:h2:file:/work/store-java-mysql-db;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DEFAULT_NULL_ORDERING=HIGH" > /work/store-java-magic42.log 2>&1'
   curl -fsS http://127.0.0.1:18080/actuator/health
   # 本次回應：{"status":"UP"}
   ```

6. 執行實測：

   ```sh
   spikes/canonical/.venv/bin/python spikes/chain/measure.py
   ```

   程式會先以 `git check-ignore` 檢查路徑，才產生測試 payment keys；檔案權限設為 0600。使用本機 topup API 取得測試 ADA，經 `cardano-cli conway transaction build/sign/submit` 送出，讀 UTxO 確認包含，再讀 HTTP metadata，嚴格解碼 provider 的 `0x` hex 並比對 32-byte hash。

   完整成功輸出：

   ```json
   {"tx_id":"8c2afcfadea9721506a6edd08f305a7024e78c1537429c9a6b6826a1d385818a","signed_size_bytes":348,"actual_fee_lovelace":175269,"linear_fee_lovelace":170693,"local_inclusion_seconds":2.825,"indexer_readback_seconds":3.341,"readback_equal":true}
   ```

7. 可另以 `GET /api/v1/txs/{tx_id}/metadata` 與 `GET /api/v1/txs/{tx_id}` 核對；原始回應已在 `chain-results.json`。本次讀回 hash（去掉表示 bytes 的 `0x` prefix）：`8ab9123cac1dc83e558a95c183e16d1dc69af56d117b73538ec6b3a3b71b99fd`。

8. 完成後停止本 session 的測試容器，保留本機資料供後續核對；未清除既有 Docker images／其他服務。

`measure.py` 是可丟棄的 spike 程式；CLI＋Java Store 的選擇不約束 D11 或 D9。這套啟動流程包含手動 runtime 對照，尚未整理成產品 integration harness。

## 失敗紀錄與未驗證項

- 初次使用 latest release `0.12.0-beta5`：Yano bootstrap 交接 Haskell 後 tip 停在 block/slot 1167，等待期間未前進；不把「程序已啟動」當作可送交易。根因未釐清，改測 stable；beta 容器已停止。
- stable 0.10.6 的 native Store 在握手後未提供 API；原生 runtime 根因未釐清。附帶 Java jar 與 native 的 migration checksum 不同，混用資料庫確實失敗；改用獨立資料庫。Java jar 的 schema 使用 `auto_increment`，PostgreSQL mode 不可用，改 MySQL mode；其預設 magic 為 0，需明訂 42 與 genesis 一致。最終健康檢查、indexing 與讀回均成功。
- 初始化 topup 的第一個 HTTP 請求超過原 10 秒 timeout；提高到 60 秒，重跑前先查 UTxO，避免僅因 client timeout 就再 topup。
- hash 的 `0x` prefix 是 provider 表示差異，不是 commitment mismatch；只接受能解碼為相同 32 bytes 的內容。
- 未跑 preprod（沒有 faucet／錢包準備）、mainnet、validator 合約、批次提交、CIP-30 瀏覽器簽署。只有本機 devnet 可用，因此未同時送另一網路。
- LICENSE、commit／push 與任何對外發布仍未執行。

## 權威來源

- [Cardano fee structure](https://docs.cardano.org/about-cardano/explore-more/fee-structure)：線性 minimum 與參數含義；本次數字來自實際 node 查詢。
- [Yaci DevKit stable release](https://github.com/bloxbean/yaci-devkit/releases/tag/v0.10.6)：使用版本與 distribution。
- [Cardano transaction metadata](https://developers.cardano.org/docs/transaction-metadata/)：metadata 的資料型別與大小界線。
