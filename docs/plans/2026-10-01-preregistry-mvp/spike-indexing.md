# 讀取與索引 spike

查詢日期：2026-10-01。Will 選 A：公開既有交易查詢＋步驟 2 本機讀回證據；不註冊帳號、不取得 key、不送新交易、不安裝自架堆疊。公開樣本不是本產品 commitment。

## 結果

| 來源 | label 清單 | 單筆 metadata | 地址交易 | 驗收程度 |
|---|---|---|---|---|
| Koios Public | 成功；674 兩頁；123456789 排序後一頁 1 筆、下一頁空 | POST tx_metadata 成功 | POST address_txs 成功 | 公開 mainnet 樣本已測；preprod 暫用 label 查詢成功 |
| Blockfrost | 官方支援 | 官方支援 | 官方支援 | 三個未帶 key 查詢均 403；不等同不支援，也未完成成功驗收 |

Koios 成功查詢的 HTTP 往返約 0.9–2.3 秒（最初七次），不是新交易索引延遲或 finality。大量 label 674 的全歷史 `order=block_height.asc,tx_hash.asc` 查詢在 client 40 秒逾時；低量 123456789 同排序成功並取得空尾頁。不可由兩頁樣本聲稱已列完熱門 label。產品 adapter 須明確排序、去重、保留 watermark、重掃重疊區間及處理 rollback；大量歷史回填需另驗收。

## 額度與 request 估算

[Koios tiers](https://koios.rest/tiers.html)：Public 5000/day、100/10s、30s query timeout；Free 50000/day 需 key；Public CORS restricted，瀏覽器直連尚未驗收。公開 read proxy 可只傳 tx hash／label／地址，不需 manifest 或 salt；是否採用於 D9 拍板與實作。API spec 指 public body 1KB、registered 5KB；批量 tx hashes 應依實際 JSON bytes 切批。

[Blockfrost 文件](https://docs.blockfrost.io/)：需 project_id，列表預設／最多 100/page，page/count/order；三種路徑見下方實際請求。免費 STARTER 方案見 [方案頁](https://blockfrost.dev/overview/plans-and-billing)，本輪未重驗圖中的數字額度，不以此承諾容量。

範例（估算，非產品流量實測）：每 5 分鐘一次增量 label 查詢＝288 requests/day；若每次 0–100 筆且每 10 hashes 查一次 metadata，每日新增 1000 筆，則約 288＋ceil(1000/10)＝388/day（不含 tip、重試、分頁、交易身分讀取與狀態頁流量）。若每筆另查 tx_info 增加 1000/day，合計 1388/day。每次需兩頁另增 288/day。每 1000 個狀態頁讀取各用 metadata＋tx_info 兩次，再增 2000/day。公開 5000 額度不能被每個訪客無限輪詢；是否集中快取由 D9 決定。

歷史回填：Koios 頁長 P≤1000，N 筆需 floor(N/P)＋1 次列表（包含空尾頁），另需 ceil(N/B) 次 metadata 批量（B 由 payload bytes 決定）；Blockfrost P≤100，其 label 列表含 json_metadata，額外 tx 身分／區塊讀取另計。估算不是限額保證。

## Label 碰撞

實測 label 123456789 在 mainnet、preprod 均非空；只可保留為已完成 spike 的暫用值，不可直接選為產品 label。674 是 CIP-20 通用訊息 label。registry 快照在 indexing-results.json；registry 沒登記不代表鏈上沒有人使用。

[CIP-10](https://cips.cardano.org/cip/CIP-10) 保留 65536–131071 為 private use；測試網可選該範圍的暫用 label 並以 app/domain、版本、網路、schema 過濾，不能宣稱唯一。mainnet 若啟動則重新查 registry 與鏈上使用，正式註冊需另授權對外 PR。本輪不選定具體 label，也不提交 PR。

## 自架比較（官方文件，未安裝）

[db-sync README](https://github.com/IntersectMBO/cardano-db-sync) 的 2025-05 快照：mainnet 64GB RAM、4 cores、700GB+ SSD、60k IOPS 建議；preprod 約 node 12GB＋ledger 2GB＋Postgres 16GB，node 5.5GB RAM＋db-sync 3.5GB RAM，尚需 PostgreSQL／OS 空間。這是舊快照，部署時須重查；費用依主機商，未取得報價。metadata 開啟後可自行寫 label 查詢與服務。

[Kupo README](https://github.com/CardanoSolutions/kupo)：核心依輸出地址 pattern 索引 output references／values／datums／scripts，不能只憑有 UTxO HTTP API 就當成完整 metadata label 索引；本輪未驗證其全部 API 或設計擴充。

[Oura](https://github.com/txpipe/oura)：鏈事件管線；本產品仍需自行保存 metadata／rollback 與查詢 API，沒有本次實測容量／主機價格。自架方案須配合 node 同步與持續維運，不在本輪安裝。

## 尚未驗收

自家 preprod commitment 的提交→索引與等待時間、Blockfrost 帶合法 key 成功查詢、瀏覽器 CORS、全歷史熱門 label 遍歷、兩來源切換與 rollback。步驟 6、8 補自家 preprod 驗收；本輪依 Will 選 A 的 scope 完成，不宣稱原先所有來源的成功實測已完成。

## 再現請求與輸出

完整 JSON 輸出與 registry 快照：`indexing-results.json`。以下為實際請求；不含 secrets。

### label-page1

```sh
curl -sS --max-time 40 'https://api.koios.rest/api/v1/tx_by_metalabel?_label=674&limit=2&offset=0'
```

HTTP 200; 2.208 秒。

```json
[
  {
    "tx_hash": "8ca81569cf1e8214f0f5e6f241ad7c958e16af690c88ec04e8a357fbdb4fe737",
    "block_hash": "07b4b29ed6ee9ff88b68ed8bf02ed79de8b8fc9bd0413616af042e915a47bd64",
    "block_height": 5855845,
    "epoch_no": 272,
    "absolute_slot": 32227721,
    "tx_timestamp": 1623794012
  },
  {
    "tx_hash": "17b35aeac1833badec0466c6fe9c3c9e06c49a6e39c967a05627ca7673bfbb2b",
    "block_hash": "b8ad64a5509d40e9d36a6f197e855a4671607b5cea3d928fdbbcae3e84240145",
    "block_height": 5876164,
    "epoch_no": 273,
    "absolute_slot": 32634132,
    "tx_timestamp": 1624200423
  }
]
```

### label-page2

```sh
curl -sS --max-time 40 'https://api.koios.rest/api/v1/tx_by_metalabel?_label=674&limit=2&offset=2'
```

HTTP 200; 2.234 秒。

```json
[
  {
    "tx_hash": "0793bed6fde416df9d6093930f5085ba963aa3628b980b2496d82bb6c550657c",
    "block_hash": "e5bc76b19b84dc62f8e1f93bd46f1f1fa1dc36297ab04099302a4601c8ebbfd6",
    "block_height": 5890319,
    "epoch_no": 273,
    "absolute_slot": 32919151,
    "tx_timestamp": 1624485442
  },
  {
    "tx_hash": "f5a45daf1980a7beb5f56998e4c3f333bf3a7c6dee61fcd06739e029a5270823",
    "block_hash": "003f842fccbc67a35914ce882dd4afb876af729e984037d1b8444c243942d051",
    "block_height": 5890327,
    "epoch_no": 273,
    "absolute_slot": 32919273,
    "tx_timestamp": 1624485564
  }
]
```

### tx-metadata

```sh
curl -sS --max-time 40 https://api.koios.rest/api/v1/tx_metadata -H 'Content-Type: application/json' --data '{"_tx_hashes":["8ca81569cf1e8214f0f5e6f241ad7c958e16af690c88ec04e8a357fbdb4fe737"]}'
```

HTTP 200; 1.029 秒。

```json
[
  {
    "tx_hash": "8ca81569cf1e8214f0f5e6f241ad7c958e16af690c88ec04e8a357fbdb4fe737",
    "metadata": {
      "674": {
        "msg": [
          "this is an example transaction message",
          "we really need this on cardano",
          "support the metadata-label 674",
          "thx, martin :-)"
        ]
      }
    }
  }
]
```

### tx-info

```sh
curl -sS --max-time 40 https://api.koios.rest/api/v1/tx_info -H 'Content-Type: application/json' --data '{"_tx_hashes":["8ca81569cf1e8214f0f5e6f241ad7c958e16af690c88ec04e8a357fbdb4fe737"],"_inputs":true,"_metadata":true}'
```

HTTP 200; 1.463 秒。

```json
[
  {
    "tx_hash": "8ca81569cf1e8214f0f5e6f241ad7c958e16af690c88ec04e8a357fbdb4fe737",
    "block_hash": "07b4b29ed6ee9ff88b68ed8bf02ed79de8b8fc9bd0413616af042e915a47bd64",
    "block_height": 5855845,
    "epoch_no": 272,
    "epoch_slot": 86921,
    "absolute_slot": 32227721,
    "tx_timestamp": 1623794012,
    "tx_block_index": 5,
    "tx_size": 362,
    "total_output": "1822883",
    "fee": "177117",
    "treasury_donation": "0",
    "deposit": "0",
    "invalid_before": null,
    "invalid_after": "32327691",
    "collateral_inputs": [],
    "collateral_output": null,
    "reference_inputs": [],
    "inputs": [
      {
        "value": "2000000",
        "tx_hash": "5b2357a7d55b52359b7b19213734b2e5569b5f66303dd50fad172a2b3f7cd110",
        "tx_index": 0,
        "asset_list": [],
        "datum_hash": null,
        "stake_addr": null,
        "inline_datum": null,
        "payment_addr": {
          "cred": "e71a88122353a973c5cdc332e254d67452bd64c0605a7f98536aec63",
          "bech32": "addr1v8n34zqjydf6ju79ehpn9cj56e6990tycps95luc2d4wccc5q0n4y"
        },
        "reference_script": null
      }
    ],
    "outputs": [
      {
        "value": "1822883",
        "tx_hash": "8ca81569cf1e8214f0f5e6f241ad7c958e16af690c88ec04e8a357fbdb4fe737",
        "tx_index": 0,
        "asset_list": [],
        "datum_hash": null,
        "stake_addr": null,
        "inline_datum": null,
        "payment_addr": {
          "cred": "e71a88122353a973c5cdc332e254d67452bd64c0605a7f98536aec63",
          "bech32": "addr1v8n34zqjydf6ju79ehpn9cj56e6990tycps95luc2d4wccc5q0n4y"
        },
        "reference_script": null
      }
    ],
    "withdrawals": [],
    "assets_minted": [],
    "metadata": {
      "674": {
        "msg": [
          "this is an example transaction message",
          "we really need this on cardano",
          "support the metadata-label 674",
          "thx, martin :-)"
        ]
      }
    },
    "certificates": [],
    "native_scripts": [],
    "plutus_contracts": [],
    "voting_procedures": [],
    "proposal_procedures": []
  }
]
```

### address-txs

```sh
curl -sS --max-time 40 'https://api.koios.rest/api/v1/address_txs?limit=2' -H 'Content-Type: application/json' --data '{"_addresses":["addr1v8n34zqjydf6ju79ehpn9cj56e6990tycps95luc2d4wccc5q0n4y"],"_after_block_height":0}'
```

HTTP 200; 1.219 秒。

```json
[
  {
    "tx_hash": "cc188237468a030d5c3c7521211cf306250eac66faed18a56a1e930971d97f20",
    "epoch_no": 429,
    "block_height": 9151122,
    "block_time": 1691860963
  },
  {
    "tx_hash": "ff9edc34a282bc4a3e97e971064a780d7fb192704bbf5c5f212c4ff6c1ec3e25",
    "epoch_no": 405,
    "block_height": 8640857,
    "block_time": 1681371861
  }
]
```

### spike-label-mainnet

```sh
curl -sS --max-time 40 'https://api.koios.rest/api/v1/tx_by_metalabel?_label=123456789&limit=2'
```

HTTP 200; 0.887 秒。

```json
[
  {
    "tx_hash": "dd18b813a804303491799540988b8b05e76c1bacfbae0576a62c6f4cb8ea1a34",
    "block_hash": "d4cca22c578258dc6c9126f9e560a26db66fb7502bbe09a420fd31b189e2398a",
    "block_height": 5544998,
    "epoch_no": 257,
    "absolute_slot": 25906914,
    "tx_timestamp": 1617473205
  }
]
```

### spike-label-preprod

```sh
curl -sS --max-time 40 'https://preprod.koios.rest/api/v1/tx_by_metalabel?_label=123456789&limit=2'
```

HTTP 200; 1.379 秒。

```json
[
  {
    "tx_hash": "643bfc80151805dfcd48fab8913f493da39f192ed51472a5e4f8b135a555ee37",
    "block_hash": "7a674921268e46b0cb84580a2d4b3e760635ccf6c6ea937825c4f0b5dde93372",
    "block_height": 507347,
    "epoch_no": 44,
    "absolute_slot": 17759938,
    "tx_timestamp": 1673443138
  },
  {
    "tx_hash": "250d4d28e00f8ceb9092026cc5b327775637ea59dedfe7d25cd0f3a13ead7c67",
    "block_hash": "31752fade64e048d0d26a5f9c28275c47946259576fbaac4657a78c98196ea3a",
    "block_height": 507350,
    "epoch_no": 44,
    "absolute_slot": 17760085,
    "tx_timestamp": 1673443285
  }
]
```

### blockfrost-no-key-label

```sh
curl -sS --max-time 40 'https://cardano-mainnet.blockfrost.io/api/v0/metadata/txs/labels/674?count=2&page=1'
```

HTTP 403; 0.515 秒。

```json
{
  "error": "Forbidden",
  "message": "Missing project token. Please include project_id in your request.",
  "status_code": 403
}
```

### blockfrost-no-key-tx-metadata

```sh
curl -sS --max-time 40 https://cardano-mainnet.blockfrost.io/api/v0/txs/8ca81569cf1e8214f0f5e6f241ad7c958e16af690c88ec04e8a357fbdb4fe737/metadata
```

HTTP 403; 0.365 秒。

```json
{
  "error": "Forbidden",
  "message": "Missing project token. Please include project_id in your request.",
  "status_code": 403
}
```

### blockfrost-no-key-address-txs

```sh
curl -sS --max-time 40 'https://cardano-mainnet.blockfrost.io/api/v0/addresses/addr1v8n34zqjydf6ju79ehpn9cj56e6990tycps95luc2d4wccc5q0n4y/transactions?count=2&page=1'
```

HTTP 403; 0.447 秒。

```json
{
  "error": "Forbidden",
  "message": "Missing project token. Please include project_id in your request.",
  "status_code": 403
}
```

### ordered-674-unbounded

```sh
curl -sS --max-time 40 'https://api.koios.rest/api/v1/tx_by_metalabel?_label=674&limit=2&offset=0&order=block_height.asc,tx_hash.asc'
```

HTTP None; 40 秒。

```json
"Client read timeout; full-history ordering not validated"
```

### ordered-spike-label-page-1

```sh
curl -sS --max-time 40 'https://api.koios.rest/api/v1/tx_by_metalabel?_label=123456789&limit=2&offset=0&order=block_height.asc,tx_hash.asc'
```

HTTP 200; 2.479 秒。

```json
[
  {
    "tx_hash": "dd18b813a804303491799540988b8b05e76c1bacfbae0576a62c6f4cb8ea1a34",
    "block_hash": "d4cca22c578258dc6c9126f9e560a26db66fb7502bbe09a420fd31b189e2398a",
    "block_height": 5544998,
    "epoch_no": 257,
    "absolute_slot": 25906914,
    "tx_timestamp": 1617473205
  }
]
```

### ordered-spike-label-page-2

```sh
curl -sS --max-time 40 'https://api.koios.rest/api/v1/tx_by_metalabel?_label=123456789&limit=2&offset=2&order=block_height.asc,tx_hash.asc'
```

HTTP 200; 1.093 秒。

```json
[]
```
