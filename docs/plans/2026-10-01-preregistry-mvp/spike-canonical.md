# Spike：跨語言正規化與 commitment

2026-10-01。本附件是技術實測，不是已拍板的產品格式；D5、D6、D11 仍未決。

## 結果與重現

Python 3.13.13 與 Node 22.23.3 直接執行 TypeScript；Python `rfc8785==0.1.4`、`cbor2==5.8.0`；Node 套件與 runtime 版本由 `spikes/canonical/package-lock.json` 固定，Python 完整環境由 `requirements.lock.txt` 固定。

從 repo 根目錄執行：

```sh
uv venv spikes/canonical/.venv
uv pip sync --python spikes/canonical/.venv/bin/python spikes/canonical/requirements.lock.txt
npm ci --prefix spikes/canonical
spikes/canonical/.venv/bin/python spikes/canonical/compare.py
```

已實際執行最後一行；安裝時使用 `uv pip install`／`npm install`，上面乾淨重建的 `sync`／`ci` 尚未重跑。

輸出：

```json
{"vectors":66,"matched":60,"rejected_in_both":6,"key_order_checks":6,"changed_value_checks":6,"python":"3.13.13","node":"v22.23.3"}
```

`test-vectors.json` 有 2 種格式 × 3 種構造 × 11 組輸入＝66 個向量。60 個有效輸入的 canonical bytes 與 hash 兩語言完全相同；6 個超出 safe integer 的輸入在兩邊都拒絕。`canonical-results.json` 保存機械結果。

輸入涵蓋 key 順序、Unicode（包括 UTF-16 與 UTF-8 排序不同的 key）、浮點數、整數值浮點數、負零、safe integer 邊界、大整數與其字串替代、空陣列、空物件、巢狀物件。每種格式／構造都實測「只換 key 順序 hash 不變」與「改一個值 hash 改變」，各 6 組。

## 實驗編碼（待 D5、D6 決定）

- 格式 A：RFC 8785 JCS UTF-8 bytes＋SHA-256。
- 格式 B：deterministic CBOR 的 **length-first map key ordering**（RFC 8949 §4.2.3）＋BLAKE2b，輸出長度 32 bytes。不是未指定排序規則的泛稱「canonical CBOR」。本次 map key 限定 JSON 字串。
- 共同輸入域：有限 JSON number；整數不得超過 ±(2^53−1)，超過時用十進位字串。整數值 float 與負零轉成相同整數表示（例如 1.0 → 1，−0 → 0），CBOR 也明確遵守此 JSON 語意。
- 固定公開測試 salt：bytes 00–1f；domain tag＝`cardano-ai-preregistry:spike`；版本＝0（uint16 big-endian）；網路＝`devnet`。這不是生產 salt 或正式 v1。
- `frame(x)`＝uint32 big-endian byte length＋x；prefix＝frame(domain tag)＋版本＋frame(network)。長度框架避免串接邊界歧義。
- 串接：H(prefix＋salt＋frame(canonical bytes))。
- HMAC：HMAC-H(salt, prefix＋frame(canonical bytes))；BLAKE2b 的 HMAC 使用 32-byte output 的 hash 函式，並非「64-byte output 截成 32 bytes」。
- Merkle：每個頂層欄位為 leaf，key 依 UTF-16 排序；leaf salt 從 master salt 以 HMAC-SHA-256 派生；leaf、internal node、empty tree 與 root wrapper 各有 domain byte；奇數節點複製末節點，root wrapper 固定 leaf 數。程式註解與兩語言實作定義完整 bytes。

Merkle 本次只證明兩語言得到相同 root；未實作選擇性揭露 proof/verifier，也未證明使用者體驗或抗選擇性報告能力。

## 已確認陷阱

| 項目 | 證據與產品含義 |
|---|---|
| JSON 大整數 | `9007199254740993` 在 JavaScript 已無法精確表示；不得先 parse 成 Number 再補救。Python 保留原整數並拒絕；TS 即使已四捨五入，也拒絕 unsafe integer。seed、ID、大數值可用十進位字串 |
| JCS 的排序與浮點數 | key 按 UTF-16 code unit，不能用 Python 預設字串排序或 `json.dumps(sort_keys=True)` 替代；數字採 ECMAScript 序列化。Unicode 不做 NFC/NFD 合併 |
| CBOR 的數值型別 | Python 1.0 原本是 float、JS 1 是 Number；必須先定 JSON→CBOR 的語意。本實驗正規化整數值 float，不能把函式庫預設等同契約 |
| CBOR map 排序 | RFC 8949 §4.2.1 與 §4.2.3 是不同排序規則；需在產品格式明訂。任意 deterministic CBOR 也不等於 Cardano PlutusData 編碼，不能據此宣稱 validator 可直接重算 manifest |
| Node runtime 相容性 | 本機 Node 26.10.0＋`cbor@10.0.12` 對 `{a:1,z:2}` 的 `encodeCanonical` 實測只得到 `a2`；Node 22.23.3 同程式得到完整 `a2616101617a02`，66 組對照全部通過。此 runtime／套件組合不建議用於產品，尚未研究底層 stream 根因 |
| Python 相依相容性 | 初次安裝 `pycardano==0.19.2` 與 `cbor2==6.1.4` 時，`cbor2pure==5.8.0` import 缺 `CBORDecodeValueError`。已將 cbor2 固定為 5.8.0；不將未驗證最新版視為可用環境 |

## Manifest 欄位草案

待 D5 決定，不代表 schema 已定案：

| 欄位 | 草案與待決差異 |
|---|---|
| `schema_version` | manifest schema 版本，與 commitment 格式版本分開 |
| `experiments[]` | C1 建議：每個實驗含 ID、模型參照、設定、評分方法及 `planned_runs`；只記總次數的替代方案會失去各次配置 |
| `datasets[]` | C2 建議：版本／revision、角色 `evaluation`／`retrieval`／`training`、必要檔案 hash；替代方案僅含 evaluation |
| `models[]` | 模型名稱與不可變版本／revision；對遠端 API 無法釘死版本時明示限制 |
| `metrics[]` | 名稱、版本、評分設定；不代表公平性已驗證 |
| `artifacts[]` | 已存在的程式、資料、設定檔 hash 與角色；預先登記時不能填入尚未產生的結果檔 hash |
| `network` | 本次測試固定在 commitment prefix；是否也放 manifest／metadata 由 D5、D6 決定 |
| `reveal_deadline` | D8 決定是否必填；若全部 manifest 都隱藏在 salted hash 裡，揭露前不能推導逾期。D8 拍板時需決定可公開核對的期限欄位位置 |

RevealBundle 可含 manifest、salt、tx hash、network、結果摘要與結果檔 URL/hash（D7=A）；結果檔的 hash 只證明揭露後檔案一致，不能倒推成事前已承諾的結果。是否帶宣稱執行時間由 D6 決定。

## 拍板材料

D5：兩種候選都可跨語言重現；網頁產品優先考慮 JCS 的可讀性與既有 JSON 工具鏈，CBOR 須明訂數值與排序 profile。

D6：串接與 HMAC 都能做到完整揭露；本實驗顯示明確長度框架可消除串接的編碼歧義。Merkle 增加 proof 格式與部分揭露規則，目前需求未要求選擇性揭露。

D11：本次 runtime 與套件只是 spike 選擇，不預選產品技術棧。

## 權威來源

- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html)：JCS 的 I-JSON、UTF-16 key 排序、數字與 Unicode 規則。
- [RFC 8949 §4.2](https://www.rfc-editor.org/rfc/rfc8949.html#section-4.2)：deterministic CBOR 與 map ordering。
- [node-cbor](https://github.com/hildjj/node-cbor)：本次 TS 使用的 CBOR encoder；安裝版本由 lockfile 固定。
