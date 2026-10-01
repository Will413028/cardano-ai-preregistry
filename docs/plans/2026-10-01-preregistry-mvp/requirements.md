# 需求清單

計畫：`../2026-10-01-preregistry-mvp.md`。整理日期 2026-10-01。

## 需求來源

| 代號 | 來源 | 狀態 |
|---|---|---|
| SRC-A | 產品構想筆記（私人筆記，未公開，2026-10-01） | 唯讀；以下引用為摘要 |
| SRC-B | 本 repo `README.md`（尚無 commit，2026-10-01 讀取） | 公開構想文件 |
| SRC-C | 本 repo `AGENTS.md`（尚無 commit，2026-10-01 讀取） | 專案限制 |
| SRC-D | 專案索引頁（私人筆記，未公開，2026-10-01） | 唯讀；以下引用為摘要 |

## 來源句（逐句編號）

| 編號 | 來源 | 內容 |
|---|---|---|
| S1 | SRC-A | 服務做 RAG／Agent／模型評測的開發者與研究者。（摘要） |
| S2 | SRC-A | 執行實驗前，固定測試集版本、模型版本、設定、評分方法與預計執行的實驗。（摘要） |
| S3 | SRC-A | 對完整 manifest 加鹽計算 hash，提交 Cardano commitment。（摘要） |
| S4 | SRC-A | 內容可保留在使用者端或私密儲存。（摘要） |
| S5 | SRC-A | 完成後公開原始設定、結果與必要檔案，讓讀者核對與事前版本是否一致。（摘要） |
| S6 | SRC-A | 介面可呈現每個已登記實驗的完成、尚未揭露或終止狀態，讓讀者看到已登記的成功與失敗案例。（摘要） |
| S7 | SRC-A | 不證明所有實際執行的實驗都有登記，也不證明實驗依計畫執行、結果真實或評分方法公平。（摘要） |
| S8 | SRC-A | Cardano 提供不由產品公司或實驗者單方控制的公開事前承諾與版本順序；不是 Cardano 獨有能力；差異在第三方可獨立核對公開承諾。（摘要） |
| S9 | SRC-A | hash 不保存原始資料，內容保存與後續取得需另行處理。（摘要） |
| S10 | SRC-A | 是否需要 smart contract 尚未決定。（摘要） |
| S11 | SRC-A | OSF 與 AsPredicted 已有事前固定計畫、私密版本與後續公開的流程；不能宣稱私密預註冊是現有工具沒有的功能。（摘要） |
| S12 | SRC-A | 待驗證的產品增量是 AI 實驗整合、操作成本及獨立查核；沒有具名付費需求或試用／留存證據。（摘要） |
| S13 | SRC-A | 排除收款、分潤、預約，以及 Token／NFT 作為產品核心。（摘要） |
| S14 | SRC-B | Define a canonical experiment manifest covering datasets, model versions, settings, metrics and planned runs. |
| S15 | SRC-B | Commit a salted manifest hash on Cardano before execution. |
| S16 | SRC-B | Reveal the manifest and results, and verify the commitment while tracking registered experiment statuses. |
| S17 | SRC-B | Use Cardano to reduce dependence on a single operator and support independent verification. |
| S18 | SRC-B | Payments, revenue splitting and bookings are outside the product scope. Token issuance, NFTs, betting and cryptocurrency prizes are not the product core. |
| S19 | SRC-B／SRC-C | Commitments do not prove actual execution, truthful results, fair scoring or registration of every experiment. Original files require separate storage. |
| S20 | SRC-C | Do not present planned functionality as implemented, deployed or validated by users. |
| S21 | SRC-C | Distinguish blockchain commitments and validator checks from claims about external facts. |
| S22 | SRC-D | 事前定義資料集、模型、設定、評分方法與預計執行次數；呈現待揭露、完成或終止狀態。（摘要） |

### 來源之間的不一致

| 編號 | 不一致 | 處理 |
|---|---|---|
| C1 | S2「預計執行的實驗」與 S14「planned runs」、S22「預計執行次數」：manifest 固定的是「實驗清單（每個實驗的設定）」還是「執行次數」 | 併入決定 D5 |
| C2 | S2「測試集版本」與 S14「datasets」、S22「資料集」：只固定評測用測試集，還是含訓練／檢索語料 | 併入決定 D5 |
| C3 | S6 的狀態名「完成／尚未揭露／終止」與 S22「待揭露／完成／終止」用詞不同，語意相同 | 統一用「尚未揭露／已揭露（完成）／終止」；狀態判定規則見 D8 |

## 需求清單

類別：畫面（UI）、API、資料實體（DATA）、流程（FLOW）。「推論」項沒有來源句直接支持。

| ID | 類別 | 需求 | 來源 | 對應 |
|---|---|---|---|---|
| R01 | FLOW | 使用者在執行前建立 manifest：測試集／資料集版本、模型版本、設定、評分方法、預計實驗或次數 | S2、S14、S22 | 步驟 5、6；D5 |
| R02 | FLOW | 以正規化（canonical）表示加鹽計算 manifest hash | S3、S14、S15 | 步驟 3、5、6；D5、D6 |
| R03 | FLOW | 在執行前把 hash 提交為 Cardano commitment | S3、S15 | 步驟 2、6；D3、D4、D10 |
| R04 | FLOW | manifest 與 salt 在揭露前保留在使用者端或使用者選的私密儲存 | S4 | 步驟 6；不變量 I3 |
| R05 | FLOW | 揭露原始設定、salt、結果與必要檔案 | S5、S16 | 步驟 7；D7 |
| R06 | FLOW | 讀者可獨立核對揭露內容與事前 commitment 一致，不依賴營運者 | S5、S8、S17 | 步驟 7；不變量 I4 |
| R07 | UI | 呈現每個已登記實驗的狀態：尚未揭露、已揭露、終止（完整列舉依 D8） | S6、S16、S22 | 步驟 8；D8、D9、D12 |
| R08 | UI | 介面與 verifier 輸出明示驗證邊界（不證明真實執行、結果真實、評分公平、全部登記） | S7、S19、S21 | 步驟 7、8、9；不變量 I6 |
| R09 | DATA | Manifest 實體與其 schema 版本 | S2、S14 | 步驟 3、5；D5 |
| R10 | DATA | Commitment 實體：hash、鏈上交易、區塊時間、登記者 | S3、S8 | 步驟 6；D3、D4 |
| R11 | DATA | Reveal 實體：manifest、salt、結果、檔案 hash 與取得位置 | S5、S9 | 步驟 7；D6、D7 |
| R12 | DATA | 終止紀錄：登記者聲明不再揭露或中止 | S6 | 步驟 8；D8 |
| R13 | API | 讀者以程式查詢已登記實驗與狀態（推論：S6 只寫「介面」） | 推論 | 步驟 8；D2、D9 |
| R14 | API | 可獨立安裝執行的 verifier（CLI 或函式庫）（推論：由 S8、S17 的獨立核對導出） | 推論 | 步驟 5、7；D2、D11 |
| R15 | FLOW | 與 AI 評測工作流程整合（推論：S12 只寫「待驗證的產品增量」，未指定對象） | 推論 | D2；範圍「延後」 |
| R16 | DATA | 個別檔案完整性（每個必要檔案各自 hash）（推論：S5「必要檔案」與 S9） | 推論 | 步驟 7；D6 |
| R17 | DATA | 登記者身分與 commitment 綁定，使未揭露的承諾能歸屬到同一登記者（推論：S6 要讓讀者看到失敗案例） | 推論 | 步驟 6、8；D4、D8 |
| R18 | FLOW | 揭露期限（推論：沒有期限，「尚未揭露」無法區分進行中與放棄） | 推論 | 步驟 8；D8 |
| R19 | — | 不做收款、分潤、預約、Token 發行、NFT、下注、加密貨幣獎金 | S13、S18 | 範圍「不做」；全域約束 |
| R20 | — | 文件不得把規劃中功能寫成已實作、已部署或已被使用者驗證 | S20 | 全域約束；步驟 10 |

推論項的處理（phase-plan 第 1 步判準）：R13、R14、R15 改變範圍 → 併入 D2；R16 改變資料模型 → D6；R17 改變資料模型與信任模型 → D4；R18 改變資料模型 → D8。沒有只寫成前提的推論項。

產生方式：人工逐句整理 SRC-A～SRC-D；`python3 check_plan.py` 核對每個 R 編號都出現在計畫內。
