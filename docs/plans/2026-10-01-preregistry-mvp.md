# AI 實驗事前登記簿 MVP：從產品驗證到可獨立核對的登記、揭露與狀態

**Goal：** 開發者能在執行 AI 實驗前把加鹽 manifest hash 提交為 Cardano commitment，之後揭露 manifest、salt 與結果；任何讀者用獨立 verifier 與任一 Cardano 資料來源核對一致性，並在介面看到每筆登記的狀態（列舉值依 D8）與驗證邊界。終態以步驟 10 的驗收為準。若步驟 1 的結論是「不做」或需要改變產品前提，本計畫停在步驟 1，交 repo 擁有者決定，之後走步驟 10 收尾。

**上層：** 暫代（沒有主計畫）。主清單在 repo 外（私人筆記）；指向記在 repo 的本機個人脈絡檔（不進版控）。

**附件：** `2026-10-01-preregistry-mvp/`——`requirements.md`（需求來源、來源句、需求清單 R01–R20）、`non-functional.md`、`external-interfaces.md`（E1–E10）、`precedents-and-risks.md`、`check_plan.py`（本階段一次性檢查）。spike 與驗證的產出也放在這個目錄。repo 尚無 commit，沒有快照 commit。以下指令都從 repo 根目錄執行，計畫位於 `docs/plans/`。

## 全域約束與完成定義（暫代主計畫）

- 不做收款、分潤、預約、Token 發行、NFT、下注、加密貨幣獎金，也不把它們當產品核心（R19；來源 S13、S18）。
- 文件、README、介面不得把規劃中的功能寫成已實作、已部署或已被使用者驗證（R20；S20）。
- 區分「鏈上承諾與合約檢查」能證明的事，與實驗執行、執行時間、結果真實、評分公平、全部登記這些外部事實（S7、S19、S21）；所有對讀者的輸出都帶驗證邊界（不變量 I6）。
- 不註冊第三方帳號、不用付費 API、不動用真實 ADA，除非該步驟的「需要人做的事」已由 repo 擁有者完成。
- repo 是公開的：不提交私鑰、助記詞、API key、`.env`；任何會產生金鑰的步驟，開工前先把金鑰檔的樣式加進 `.gitignore` 並以 `git check-ignore` 驗證。CI 需要的 API key 只能由 repo 擁有者設成 GitHub secret。
- 計畫與附件位於公開 repo：受訪者身分、原話與任何個資不進 repo，只放匿名摘要。
- 對公開 repo 的任何 push（不論哪一步）都被 LICENSE 前提擋住；push 前核對 `git remote -v` 為 `Will413028/cardano-ai-preregistry`、目前的 GitHub 帳號有該 repo 權限、目標分支為 `main`。
- 完成定義（每個產品步驟）：(1) 離線驗收入口（步驟 5 建立，暫定 `make check`）本機與 CI 全綠；需要網路的 integration 走另一個入口（暫定 `make integration`），進度表分開記；(2) 步驟列的 mutation 實際跑過且測試失敗；(3) 影響讀者看得到的輸出時，驗證邊界文字有測試守住；(4) README 的「Status」與「Development」段只寫已存在且可跑的東西；(5) 進度表更新已跑與未跑的驗收。

## 前提（開工時核對過，2026-10-01）

- 會改到或取代的既有部署是否在線：無既有部署（全新系統）。不受回滾、相容性窗口與資料搬移約束；mainnet 上的 commitment 不可撤回，寫成不變量 I1。（來源：README「No application, smart contract or deployment exists yet」，2026-10-01；已確認）
- P-授權：Will 於 2026-10-01 選分階段授權：允許產品驗證與技術 spike；產品實作等相關決定拍板後啟動。同日指示先執行步驟 2、3。下載、secrets、對外動作與新分類目錄仍需另行確認。（來源：本次拍板；已確認）
- 目標 repo 是公開 GitHub repo `Will413028/cardano-ai-preregistry`，目前只有 README.md、AGENTS.md、.gitignore（內容只忽略 `.DS_Store` 與 `.env*`），尚無 commit。（來源：本機 `git log` 回報「does not have any commits yet」、`git remote -v`、`cat .gitignore`，2026-10-01；已確認）
- 產品使用 Cardano 作為公開承諾的載體；不是 Cardano 獨有能力（S8、S17）。（來源：產品構想筆記與 README，2026-10-01；已確認為產品前提。改用非 Cardano 方案不在本計畫範圍，見「不做」；步驟 1 若顯示使用者偏好替代方案，交 repo 擁有者決定）
- 目標使用者是做 RAG／Agent／模型評測的開發者與研究者（S1）。（來源：產品構想筆記，2026-10-01；未確認——沒有訪談或使用證據，由 D1 與步驟 1 處理）
- 沒有試用、留存或付費證據（S12）。（來源：同上，2026-10-01；已確認）
- D3 已選交易 metadata，不寫 smart contract。（來源：Will 於 2026-10-01 選 D3=A；已確認）
- salt：每份 manifest 以 CSPRNG 產生 32 bytes，不重用（不變量 I8）。（來源：`external-interfaces.md` E8，2026-10-01；預設（可推翻））
- 開發與驗收用網路：Cardano preprod 測試網或本機 devnet，不用 mainnet。（來源：Will 於 2026-10-01 選 D10=A；已確認）
- 格式版本規則：testnet 階段可以升格式版本號，但已用於任何鏈上交易（含 testnet）的版本，其測試向量保留不改；mainnet 使用過的版本依 I1 永久凍結。（來源：本計畫為避免驗收向量漂移所訂，2026-10-01；預設（可推翻））
- repo 授權條款選 MIT，根目錄 `LICENSE` 已建立，copyright holder 依 repo 的 git user.name 為 Will。（來源：Will 於 2026-10-01 選 A；已確認）
- spike 用的語言與函式庫只為產出事實，不約束 D11。（來源：本計畫，2026-10-01；預設（可推翻））
- 文件語言：英文（README、AGENTS.md 現況為英文）；計畫文件用繁體中文。（來源：repo 檔案，2026-10-01；預設（可推翻））

**驗收基線（步驟 5 前）：** 無。開工時 repo 尚無 commit、沒有可執行程式或檢查指令；步驟 5 已建立驗收入口，實際結果見進度表。共用、有額度的資源（第三方 API 免費層、faucet 每 24 小時一次）一次只由一個 session 使用。

## 本階段依賴的不變量

步驟 5 已落地 `src/manifest.ts`、`src/commitment.ts`、`src/chain.ts`、`src/verifier.ts`、`src/read-proxy.ts` 與 `src/main.ts`；`registry`、真實鏈 adapter、完整揭露 bundle 與狀態仍待後續步驟。原預計模組名稱：`manifest`（schema 與正規化）、`commitment`（hash 編碼）、`chain`（送出與讀取的 adapter）、`verifier`、`registry`（狀態推導與索引）、`cli`、`web`（若 D2 要有網頁）。函式名以 `canonicalize`、`encode_commitment`、`ChainWriter`、`ChainReader`、`verify_reveal`、`derive_status` 為準，步驟 5 落地後同步改這裡。

| 不變量 | 依賴它的機制 |
|---|---|
| I1 mainnet 上的 commitment 一經確認就不可修改或撤回；任何已用於鏈上的格式版本，verifier 必須永久能驗 | `encode_commitment` 的格式版本欄位；`verify_reveal` 的版本分派；`manifest` 的 schema 版本；D5、D6、D12 的結論一旦用於 mainnet 即凍結 |
| I2 同一份 commitment 輸入（格式依 D5、D6）在所有實作得到同一 bytes 與同一 hash；編碼內含格式版本與 domain tag | `canonicalize`、`encode_commitment`、`verify_reveal`；步驟 3 的 `test-vectors.json`（跨語言共用） |
| I3 manifest 與 salt 在揭露前不離開使用者端或使用者選的私密儲存；送上鏈與送到服務端的 payload 只含白名單欄位；`reveal_deadline` 是明確允許公開的 manifest 欄位（D8），其餘 manifest 內容與 salt 不公開 | `cli` 或 `web` 的 commit 流程、`ChainWriter` 的 payload 建構函式（欄位白名單） |
| I4 驗證只依賴公開鏈上資料與揭露檔案，不依賴營運者的服務；verifier 可換資料來源 | `verify_reveal`、`ChainReader` 介面（至少兩個實作：第三方 API 或本機 devnet，以及 fixture） |
| I5 登記狀態只由 `derive_status` 從鏈上事件、揭露內容與揭露期限（依 D8）推導，營運者不能手動設定 | `derive_status`、`registry` 的路由表、`web` 的狀態頁；路由表不得有寫入狀態的路由 |
| I6 對讀者的每個輸出都帶驗證邊界，不宣稱證明了真實執行、執行時間、結果真實、評分公平或全部登記 | `verify_reveal` 的輸出格式、`web` 的狀態頁與詳情頁、README |
| I7 commitment 歸屬於登記者身分（推論，依 D4 定案；D4 選 C 時此條刪除並改寫步驟 8） | `ChainWriter` 的簽署者、`registry` 依登記者分組、`web` 的登記者頁 |
| I8 每份 manifest 的 salt 唯一、不重用 | `cli` 或 `web` 的 salt 產生函式；`registry` 偵測重複 commitment hash |
| I9 每筆 commitment 與每次核對都標明所在網路（mainnet、preprod、preview、devnet），testnet 的承諾不能被當成 mainnet 呈現 | `encode_commitment` 或交易 metadata 的網路欄位（依 D5、D12）、`verify_reveal` 輸出、`web` 的狀態頁 |

## 範圍

- 做：產品風險驗證（若 D1 選 A 或 C）；三個技術 spike（鏈上承諾的成本與大小、manifest 正規化與 hash 的跨語言可重現性、讀取與索引）；walking skeleton；三個垂直切片（登記、揭露與獨立核對、狀態介面）；硬化；收尾。
- 不做：
  - 收款、分潤、預約、Token、NFT、下注、加密貨幣獎金（產品範圍限制，S13、S18）。
  - 證明實驗確實執行、執行時間、結果真實、評分公平或全部實驗都已登記（超出 commitment 能證明的範圍，S7、S19）。
  - 改用非 Cardano 的承諾方案（產品前提，S17）；OpenTimestamps、Rekor 只在 D3 的取捨與步驟 1 的訪談中當比較對象。
  - 保存原始資料於鏈上（hash 不保存原始資料，S9；大小上限見 E1、E2）。
- 延後：
  - 與特定 AI 評測框架或 CI 的整合（R15）——觸發條件：步驟 1 或 D2 指名某個整合對象，且步驟 7 完成。
  - mainnet 發布——觸發條件：D10 選擇 mainnet 且步驟 9 完成；之後依 I1 凍結格式。
  - 自架鏈資料堆疊——觸發條件：D9 選第三方 API 後，免費層額度或可用性在步驟 9 量測中不足。
  - 多語言 verifier（第二個語言的實作）——觸發條件：D11 只選一種語言，且步驟 1 或使用者回饋要求另一語言。

## 步驟

- [ ] **1. 產品風險驗證**（被擋於：P-授權、D1（選 B 時本步跳過））
  - 範圍：依 `precedents-and-risks.md` 的四個風險，做 D1 選定的最便宜驗證（訪談、假門或手動流程），產出 `docs/plans/2026-10-01-preregistry-mvp/product-validation.md`：對象數、問題、匿名化的回答摘要、對每個風險的結論（成立／不成立／不明）、對 D2、D7 的建議。不寫產品程式碼。
  - 消費端：無（repo 未建）；產出供 D2、D7、D9、D11 使用。
  - 不能動：README 不得改寫成已有使用者或已驗證（R20）；假門頁面若發布，標明「planned」；受訪者身分與原話不進 repo，只放匿名摘要，並記錄已取得受訪者同意。
  - 驗收：`product-validation.md` 存在，四個風險各有結論與證據列；`python3 docs/plans/2026-10-01-preregistry-mvp/check_plan.py docs/plans/2026-10-01-preregistry-mvp.md` 通過。無行為改動，不適用 mutation。
  - 停止條件：P-授權或 D1 未決；結論是「沒有人要」，或風險 3（使用者偏好免費替代方案）成立——停下回報，交 repo 擁有者決定是否繼續、改變產品前提或走步驟 10 收尾。
  - 需要人做的事：聯絡受訪者並取得同意、發布假門頁面或公開貼文（對外動作）；發布假門若需 push，先定 LICENSE。
- [x] **2. Spike：鏈上承諾的成本、大小與讀回**（被擋於：P-授權）
  - 範圍：先把金鑰檔樣式（例如 `*.skey`、`*.vkey`、`keys/`）與 spike 的本機設定檔加進 `.gitignore`。在至少一個網路（本機 devnet 或 preprod；兩者都可用時兩邊都送）送出只含 metadata 的 commitment 交易（32-byte hash＋格式版本＋網路欄位＋暫用 label），量 tx size、fee、確認時間，並用一個資料來源讀回 metadata；以文件比較 D3 的選項 B（validator＋datum）與 C（批次 Merkle root）的估計大小與費用，不寫合約。產出 `docs/plans/2026-10-01-preregistry-mvp/spike-chain.md`：數字、重現指令、選用的函式庫與版本（不約束 D11）。拋棄式程式碼放在 `spikes/chain/`，不進產品模組。
  - 消費端：無（repo 未建）；產出供 D3、D4、D10、D12 使用。
  - 不能動：不連 mainnet；不在 repo 提交任何金鑰或 API key。
  - 驗收：`git check-ignore -v <金鑰檔路徑>` 對每個產生的金鑰檔都有輸出；`git status --short` 不出現金鑰檔；`spike-chain.md` 有至少一筆實際 tx hash（或本機 devnet 的 tx id）、實測 size 與 fee、與 E1 公式估計值的差異，以及「讀回的 hash 等於送出的 hash」的指令與輸出。無產品行為，不適用 mutation。
  - 停止條件：preprod 與本機 devnet 都無法使用（faucet 不可得、devnet 無法啟動）——停下回報缺的條件。
  - 需要人做的事：若用 preprod，取得 faucet tADA（captcha）；若用第三方 API 讀回，註冊免費 key（E3 或 E4）並存在本機、不進版控；安裝本機 devnet 或函式庫屬下載，需同意。
- [x] **3. Spike：manifest 正規化與 hash 的跨語言可重現性**（被擋於：P-授權）
  - 範圍：用 D5 的候選（JCS＋SHA-256、deterministic CBOR＋BLAKE2b-256）與 D6 的候選結構（串接、HMAC、Merkle）各在 Python 與 TypeScript 實作最小的 canonicalize＋hash，對同一組測試輸入（含 key 順序不同、Unicode、浮點數、大整數、空陣列、巢狀物件）比對 bytes 與 hash。產出 `docs/plans/2026-10-01-preregistry-mvp/spike-canonical.md` 與 `test-vectors.json`（每個向量：候選格式代號、domain tag、格式版本、網路欄位、輸入、canonical bytes 的 hex、salt、預期 hash）。同時草擬一份 manifest 欄位清單供 D5、D6 討論（含 C1、C2 兩種寫法）。
  - 消費端：無（repo 未建）；產出供 D5、D6、D11、步驟 5、6、7 使用。
  - 不能動：依「格式版本規則」前提，一旦某版本向量用於鏈上交易就不改。
  - 驗收：兩語言對每個向量輸出相同 hash，指令與輸出寫在 `spike-canonical.md`；列出每個候選的已知陷阱（例如 JCS 的數字序列化、CBOR 的 map key 排序規則）；記錄「改一個欄位值 hash 必變、只改 key 順序 hash 不變」的兩組實測。不適用 mutation（spike）。
  - 停止條件：某候選在兩語言之間無法得到相同 bytes 且原因不明——記錄並把該候選標為不建議，不自行換方案。
  - 需要人做的事：安裝 Python／Node 套件屬下載，需同意。
- [x] **4. Spike：讀取與索引**（被擋於：P-授權、步驟 2（需要一筆已送出的 commitment 交易））
  - 範圍：依 2026-10-01 Will 選 A，以公開既有交易測查詢能力，搭配步驟 2 的本機 commitment 讀回；devnet 交易不拿去公網查。比較第三方 API（E3、E4）依 metadata label 查詢交易的端點、分頁、延遲與每次查詢的 request 數；以文件比較自架堆疊（E5）的資源需求，不安裝。產出 `docs/plans/2026-10-01-preregistry-mvp/spike-indexing.md`：每個來源能否做到「列出某 label 的全部 commitment」「查某 tx 的 metadata」「查某地址的交易」，以及每日 request 估算；記錄 label 是否已有其他交易使用（碰撞情況）。
  - 消費端：無（repo 未建）；產出供 D8、D9、D12、步驟 8 使用。
  - 不能動：只用免費層；不寫入。
  - 驗收：每個來源三個查詢各有實際指令與輸出；需要 key 的來源記錄未授權成功驗收與官方端點，不能標成不支援。公開免費來源三種查詢至少一個成功；分頁與碰撞樣本有證據；request 估算附算式。自家 preprod 端到端讀回留步驟 6、8。不適用 mutation。
  - 停止條件：沒有任何免費來源能依 label 列出交易——停下回報，D3、D9、D12 需要重新評估。
  - 需要人做的事：本輪不註冊帳號或取得 key；若後續選需 key 的來源再另授權。
- [x] **5. Walking skeleton**（被擋於：P-授權；D1（選 A 時需步驟 1 完成且結論為繼續；選 C 時需步驟 1 的手動流程至少完成一輪且結論不是停止；選 B 時不擋）、D2、D5、D6、D11；只有 repo 擁有者能確認的前提：LICENSE（已確認 MIT））
  - 範圍：依 D11 建立專案結構、相依鎖定、lint、測試框架、CI（GitHub Actions）、離線驗收入口 `make check` 與網路驗收入口 `make integration`（CI 只跑前者）；依已決 D2=B 建立網頁端最薄路徑：使用者輸入 manifest，在瀏覽器內經 `canonicalize`→`encode_commitment`，建立同源 read proxy 的白名單與共用快取介面，步驟 8 接入真實 Koios 索引；以 fake `ChainWriter`／`ChainReader`（記憶體中模擬鏈）完成登記與揭露核對，網頁回報 match／mismatch 與驗證邊界文字；此步尚不接真實 CIP-30 簽署，真實錢包整合由步驟 6 接手。採用 D5、D6 選定格式的 `test-vectors.json` 搬進 repo 的測試資料。README 的「Development」段寫上已驗證的指令。
  - 消費端：`rg -n "canonicalize|encode_commitment|ChainWriter|ChainReader|verify_reveal" src tests`；目前為 `src/main.ts`、`src/verifier.ts`、`tests/unit/core.test.ts` 與 `tests/e2e/workflow.spec.ts`；後續步驟 6、7、8 使用相同核心介面。
  - 不能動：AGENTS.md 的產品範圍與驗證邊界段；README 不寫未實作的功能為已完成。
  - 驗收：`make check` 本機與 CI 都綠（CI 的每個 job 各自看結論）；瀏覽器 e2e 測試「透過網頁登記後，以同一 manifest＋salt 核對得 match、改一個欄位得 mismatch」；攔截網頁 network request，確認揭露前沒有送出 manifest 或 salt（I3）；mutation：把 `verify_reveal` 改成永遠回傳 match，e2e 測試必須失敗；把 `canonicalize` 改成不排序 key，測試向量測試必須失敗。
  - 停止條件：被擋於的任一項未決；D2 的結論需要的入口形態與本步範圍描述不符時，先依 phase-plan 第 5 節改寫本步範圍與驗收再開工；LICENSE 未定時可完成本機工作，但 CI 驗收要等 push，進度記「程式完成待驗收」。
  - 需要人做的事：LICENSE 已選 MIT；初始 commit 與 push 需 repo 擁有者授權（repo 目前沒有任何 commit，先確認 repo 擁有者的初始 commit 是否已建立，避免歷史分岔）。
- [ ] **6. 切片：登記（真實測試網 commitment）**（被擋於：步驟 5；D3、D4、D5、D6、D8（公開期限欄位）、D10、D12）
  - 範圍：依 D2=B 接通網頁與 CIP-30 錢包簽署（付費與身分依 D4）；依 D5、D6 實作 manifest schema v1 與 commitment 格式 v1；依 D3、D4、D12 實作真實 `ChainWriter`（測試網或本機 devnet）送出 commitment，payload 由白名單欄位建構並帶網路與公開 `reveal_deadline` 欄位（I3、I9、D8）；manifest 與 salt 存在使用者指定的本機位置（I3）；salt 每次以 CSPRNG 新產生（I8）；回傳 tx hash 與 commitment 紀錄（R10）。
  - 消費端：`rg -n "ChainWriter|encode_commitment|manifest_schema" src tests`（預計：`verify_reveal`、`registry`、`cli`、`web`）。
  - 不能動：I2 的編碼規則與已用於鏈上的測試向量；I3、I8、I9。
  - 驗收：`make check` 綠：單元測試斷言 payload 的欄位集合等於白名單、且不含 32-byte salt 序列；連續兩次 commit 同一 manifest 得到不同 salt 與不同 hash。`make integration` 對本機 devnet（或 preprod，視 D10 與可用性）跑：送出後讀回的 hash 等於本機重算，且 metadata 的 `reveal_deadline` 等於 manifest 的同名值，結果記在進度表。mutation：把 salt 從 hash 輸入拿掉，測試向量測試必須失敗；在 payload 加入一個非白名單的 manifest 欄位，白名單測試必須失敗；把 salt 改成固定值，I8 測試必須失敗。
  - 停止條件：被擋於的任一決定未決；D3 選 B（合約）時，先依 phase-plan 第 5 節把本步拆成合約與鏈下兩個子步驟並各寫驗收再開工；提交前估算或已簽交易 body 的 fee 超過 300000 lovelace（D10），必須停止送出；不得自行放寬。
  - 需要人做的事：測試網 tADA 或本機 devnet 的下載同意；簽署金鑰由執行者在本機產生，已列入 `.gitignore`。
- [ ] **7. 切片：揭露與獨立核對**（被擋於：步驟 6；D6、D7、D8）
  - 範圍：網頁揭露動作依 D7=A 產出可下載的揭露包，由登記者自行發布並提供 URL，網頁核對其內容；同一登記者以 CIP-30 簽署鏈上揭露公告，包含原 commitment tx hash、揭露包 hash 與 URL（URL 超過 metadata 單一元素長度限制時採可逆分段編碼），並讀回驗證公告與簽署者身分；揭露包包含 manifest、salt、結果、必要檔案及各自 hash（依 D6）、取得位置、commitment 的 tx hash 與網路；`verify_reveal` 只用揭露包與 `ChainReader`（至少兩種實作：第三方 API 或本機 devnet，以及 fixture）核對 commitment；核對 manifest 與登記 metadata 的 `reveal_deadline`，不一致不得回報 match；輸出 match／mismatch／commitment 不存在／檔案取不到、commitment 的區塊時間與網路，並附驗證邊界（I4、I6、I9）。
  - 消費端：`rg -n "verify_reveal|RevealBundle|ChainReader" src tests`（預計：`registry`、`web`、`cli`）。
  - 不能動：I1、I2、I4、I6、I9；`verify_reveal` 不得呼叫營運者自有的服務端點。
  - 驗收：`make check` 綠（只用 fixture `ChainReader`，無網路）；對抗測試：竄改 manifest 一個欄位、換 salt、換檔案、指向另一筆 commitment、把 testnet commitment 宣稱為 mainnet，各回報 mismatch 或網路不符；第三方 API `ChainReader` 的測試放在 `make integration`。mutation：讓 `verify_reveal` 略過檔案 hash 比對，「換檔案」測試必須失敗；讓 `verify_reveal` 不比對網路，「testnet 冒充 mainnet」測試必須失敗；刪掉驗證邊界輸出，對應快照測試必須失敗。
  - 停止條件：D6 或 D7 未決。
  - 需要人做的事：若 D7 選第三方儲存，帳號註冊與費用；若 `make integration` 要在 CI 跑，API key 由 repo 擁有者設成 GitHub secret。
- [ ] **8. 切片：登記狀態介面**（被擋於：步驟 7、步驟 4；D2、D8、D9、D12；D4（決定 I7 是否存在））
  - 範圍：`registry` 透過同源 read proxy 與共用索引快取讀 Koios Public，adapter 可替換；cache 保存鏈資料／事件並實作增量排序、去重、watermark、重疊重掃、rollback 與 request 控制。依 D9 的資料來源列出 D12 選定 label 下的全部 commitment，以 `derive_status` 依 D8 的狀態列舉與規則推導狀態（I5），依 D4 歸屬到登記者（I7），標明網路（I9）；按期／逾期依有效揭露公告的區塊時間與登記 metadata 期限比較，不依服務觀測或自述時間；揭露包 hash 與公告不符不得回報一致；依 D2 提供網頁或 CLI 列表與唯讀 API（R07、R13），每筆可連到 `verify_reveal` 結果；終止紀錄依 D8 實作（R12）：metadata 引用原 commitment tx hash，獨立核對簽署者身分與原登記者一致；不相符的終止事件不得變更狀態，原 commitment 與事件歷史保留；終止後補揭露仍可核對，主狀態保留已終止，另呈現一致／不一致結果。
  - 消費端：`rg -n "derive_status|RegistryIndex|list_commitments" src tests`（預計：`web`、`cli`）。
  - 不能動：I5（狀態只由 `derive_status` 產生）、I6、I9。
  - 驗收：`make check` 綠：fixture 測試索引重複頁、重疊掃描與 rollback 後重算，以及快取命中不重複呼叫上游、proxy 拒絕非白名單查詢；再測揭露公告的身分、原 commitment 引用與 bundle hash；偽造者公告不得變更原登記狀態；公告區塊時間等於期限視為按期，晚於期限視為逾期，揭露文件可取得性另驗；再測終止後補揭露的一致／不一致結果均不覆蓋已終止主狀態；另測逾期補揭露回報已揭露（一致／不一致）且保留逾期揭露標記；再測期限前／後未揭露分別為尚未揭露／逾期未揭露，使用登記 metadata 的公開期限；並涵蓋 D8 列舉的每個狀態，以及「已揭露但 mismatch」「揭露檔案取不到」；I5 測試＝(a) 斷言路由表沒有任何對狀態的 POST／PUT／PATCH／DELETE 路由，(b) 以 fixture 鏈資料重算整個列表並與輸出逐筆相等。mutation：把終止判成尚未揭露，狀態測試必須失敗；忽略終止事件的登記者身分核對，冒用終止 fixture 必須失敗；在路由表加一條 `PATCH /commitments/{id}/status`，I5(a) 必須失敗。
  - 停止條件：D2、D8、D9、D12 任一未決；步驟 4 結論為沒有可用的免費資料來源。
  - 需要人做的事：若 D2 包含公開網頁，部署平台的帳號與網域由 repo 擁有者處理。
- [ ] **9. 硬化**（被擋於：步驟 8；D10 決定是否包含 mainnet 準備）
  - 範圍：依 `non-functional.md` 把「未決」的門檻定成數字並加測試（登記延遲、verifier 時間、檔案大小上限、每日 request 預算）；對抗測試補齊（重放他人 commitment、同一登記者多筆承諾只揭露一筆時狀態頁要顯示其餘未揭露、格式版本未知時 verifier 的行為、重複 commitment hash 的偵測）；錯誤輸出結構化。若 D10 選 mainnet，凍結格式 v1（I1）並寫格式規格文件。
  - 消費端：`rg -n "ChainWriter|ChainReader|verify_reveal|derive_status" src tests`。
  - 不能動：I1–I9；已用於鏈上的格式版本 bytes。
  - 驗收：`make check` 綠；每個 NFR 門檻都有一個超標時會失敗的測試或量測腳本（量測腳本在 `make integration`）；mutation：把 verifier 對未知格式版本改成當作 v1 處理，對應測試必須失敗。
  - 停止條件：某 NFR 門檻在 D10 的成本上限內做不到——停下回報，不自行放寬門檻。
- [ ] **10. 收尾**：完成定義逐項核對；獨立設計審查（design-review skill）；確認長期守住不變量的檢查（測試向量測試、I3 白名單測試、I5 路由與重算測試、I9 網路測試）都在 CI 的 `make check` 內；`check_plan.py` 屬本階段一次性檢查，留在附件不進 CI；延後項附觸發條件搬回主清單，並在主清單關閉或改寫「驗證使用者需求」「定義 MVP、技術棧及驗證方式」兩項（步驟 1 結論為不做時，改寫成停止的紀錄）；需要人做的事（LICENSE、帳號、CI secret、mainnet 資金、對外發布、CIP-10 註冊）列給 repo 擁有者；把已拍板的決定依 decision-log skill 寫成 ADR（位置見決定段）。驗收：`make check` 與 CI 最新一次每個 job 都綠；`python3 docs/plans/2026-10-01-preregistry-mvp/check_plan.py docs/plans/2026-10-01-preregistry-mvp.md` 通過；design-review 的發現逐項處理並記錄於本檔；README「Status」段與實際狀態一致（人工比對清單附在進度表）。

## 決定

Will 於 2026-10-01 已拍板 P-授權與 D1–D12；LICENSE 已選 MIT。ADR 位置：repo 指令檔沒有規定，decision-log 的預設位置尚未建立，拍板後先放 `docs/plans/2026-10-01-preregistry-mvp/decisions/`。每題拍板後，同步更新主清單對應項。

- **D1 是否先做產品風險驗證再建系統**（狀態：已決 2026-10-01，Will；擋住步驟：無（已決）；影響步驟：1（跳過）、5 以後；需要的事實：無）
  - A：先做最便宜的驗證（訪談 5–10 位目標使用者＋公開假門），結論為繼續才進步驟 5——取捨：延後產品程式碼；避免在沒有使用者證據（S12）時投入鏈上與索引的成本。（建議：目前零使用證據，且替代方案成熟，S11）
  - B：跳過驗證，直接做 MVP 並以公開發布本身當驗證——取捨：更快有可展示的東西；風險是做完才發現沒人要，且鏈上格式可能已凍結。
  - C：spike（步驟 2–4）與手動流程並行驗證——取捨：技術事實與需求證據同時產生；手動流程需要有人替使用者操作錢包。
  - 結論：B，跳過步驟 1，以公開發布 MVP 驗證需求；ADR：待整理。
- **D2 MVP 的交付形態**（狀態：已決 2026-10-01，Will；擋住步驟：無（已決）；影響步驟：5、6、7、8；需要的事實：D1=B，不需步驟 1 產出）
  - A：CLI＋函式庫（登記、揭露、核對）＋靜態狀態頁——取捨：最貼近開發者工作流程、最少營運；讀者要能看狀態頁才算滿足 R07。（建議：符合 S1 的開發者族群與 I4）
  - B：網頁應用（CIP-30 錢包簽署、manifest 在瀏覽器內 hash）——取捨：門檻最低；要守 I3（瀏覽器內計算），前端與錢包整合成本高。
  - C：評測框架或 CI 外掛（例如 GitHub Action）——取捨：整合度最高（S12 的「AI 實驗整合」）；需先選定對象，範圍最窄。
  - 結論：B，網頁應用，CIP-30 錢包簽署、manifest 在瀏覽器內 hash；ADR：待整理。
- **D3 鏈上承諾機制**（狀態：已決 2026-10-01，Will；擋住步驟：無（已決）；影響步驟：6；需要的事實：步驟 2）
  - A：交易 metadata（label 依 D12），不寫合約——取捨：單筆 metadata 最簡單（步驟 2 實測 348 bytes、0.175269 測試 ADA；mainnet 成本未測，見 `spike-chain.md`）；鏈本身不檢查格式，狀態完全由鏈下推導。（建議：S10 未要求合約，且合約不能證明 S7 的外部事實）
  - B：validator＋datum（例如 Aiken 合約鎖定 UTxO，揭露時以 redeemer 消耗）——取捨：揭露與終止可由合約規則強制（例如只有登記者能終止），狀態可直接從 UTxO 讀；需要合約開發、稽核與鎖定的最小 ADA，部署後不可改（I1）；選它時步驟 6 要拆子步驟。
  - C：營運者批次聚合（Merkle root 一筆交易承載多筆）——取捨：每筆成本最低；登記時間由營運者批次決定，削弱「不由單一方控制」（S8）。
  - 業界光譜參考（不在範圍）：OpenTimestamps（免費、Bitcoin 聚合）、Sigstore Rekor（透明日誌＋RFC 3161）——用於步驟 1 比較使用者偏好。
  - 結論：A，交易 metadata 承載 commitment，不寫 validator 合約；ADR：待整理。
- **D4 誰簽署與付費，commitment 是否綁定登記者身分**（狀態：已決 2026-10-01，Will；擋住步驟：無（已決）；影響步驟：6、8；需要的事實：步驟 2；改變不變量 I7）
  - A：登記者自己的錢包簽署並付費（CLI 金鑰或 CIP-30），簽署地址即登記者身分——取捨：不託管私鑰、不由營運者控制（S8）；使用者需持有 ADA 與錢包，門檻高；同一身分的未揭露承諾可被看見（R17）。（建議）
  - B：營運者代付與代簽（relayer），登記者以鏈下簽章（例如 CIP-8 訊息簽章）證明身分——取捨：使用者零門檻；營運者付費並成為送出時間的控制者，需要防濫用與預算。
  - C：營運者代付且不綁定身分——取捨：最簡單；讀者無法把未揭露承諾歸屬到誰，S6 的「看到已登記的失敗案例」只剩匿名統計，I7 刪除。
  - 結論：A，登記者以自己的 CIP-30 錢包簽署並支付交易費，commitment 綁定可核對的錢包身分，保留 I7；ADR：待整理。
- **D5 manifest schema 與正規化／hash 演算法**（狀態：已決 2026-10-01，Will；擋住步驟：無（已決）；影響步驟：5、6；需要的事實：步驟 3；用於 mainnet 後依 I1 不可改）
  - A：JSON manifest＋RFC 8785 JCS＋SHA-256——取捨：開發者可讀、跨語言實作多（E9）；JCS 的數字規則要小心（浮點數設定值）。（建議：AI 工具鏈以 JSON／YAML 為主）
  - B：deterministic CBOR（RFC 8949 §4.2）＋BLAKE2b-256——取捨：與 Cardano 原生 hash 一致、可在合約內重算（若 D3 選 B）；人類不可直接讀，需轉換工具。
  - C：沿用既有 attestation 格式（例如 in-toto statement／DSSE envelope）包 manifest——取捨：可接到供應鏈工具生態；結構較重，對評測情境多餘欄位多。
  - 同題要決定的來源不一致：C1「預計執行的實驗清單」或「預計執行次數」（建議：實驗清單，每個實驗含設定與預計次數，兩者都涵蓋）；C2 只固定測試集或含所有資料集（建議：所有資料集，各自帶角色欄位 `evaluation`／`retrieval`／`training`）；以及網路欄位放在 manifest、commitment 編碼或 metadata（I9）。
  - 結論：格式 A，JSON manifest＋RFC 8785 JCS＋SHA-256；C1 選 A，使用 `experiments[]` 固定各實驗的模型、設定、評估指標與 `planned_runs`；C2 選 A，固定所有使用到的資料集，標明 `evaluation`／`retrieval`／`training` 角色，未使用的角色可省略；網路資訊選 A，置於 commitment 編碼並參與 hash，同時在交易 metadata 明示；兩處必須一致，manifest 不含網路欄位；ADR：待整理。
- **D6 commitment 的構造：如何加鹽、是否可選擇性揭露、揭露包欄位**（狀態：已決 2026-10-01，Will；擋住步驟：無（已決）；影響步驟：5、6、7；需要的事實：步驟 3）
  - A：串接加鹽單一 hash：H(domain tag ‖ 格式版本 ‖ 網路 ‖ salt ‖ canonical(manifest))，檔案以 hash 列在 manifest 內——取捨：最簡單、各語言好實作；揭露時必須整份公開。（建議：S5 的需求是整份公開）
  - B：HMAC(salt, domain tag ‖ 格式版本 ‖ 網路 ‖ canonical(manifest))——取捨：標準的 keyed hash 構造，避免串接邊界的歧義；與 A 成本相近，在合約內重算較麻煩（若 D3 選 B）。
  - C：Merkle tree，每個欄位或檔案各自加鹽，可只揭露部分——取捨：支援部分保密（例如私有測試集只公開 hash）；格式與 verifier 複雜度高，選擇性揭露也讓「挑著揭露」變容易。
  - 同題要定：domain tag 與格式版本的 bytes 編碼；揭露包是否帶登記者宣稱的執行時間（verifier 只能比對 commitment 區塊時間，不能證明實際執行時間，I6）。
  - 結論：構造選 A，domain tag、格式版本、網路、salt 與 canonical manifest 以明確長度編碼後計算單一 SHA-256；核對須提供完整 manifest 與 salt，不支援選擇性揭露。揭露包的開始／結束時間選填，標明為登記者自述，verifier 不判定為已證實。bytes 規格於步驟 5、6 落實為固定 domain tag、格式版本、網路識別、32-byte CSPRNG salt 與明確長度編碼，補齊 v1 跨語言向量後才可用於真實登記；ADR：待整理。
- **D7 揭露內容的保存位置**（狀態：已決 2026-10-01，Will；擋住步驟：無（已決）；影響步驟：7；需要的事實：D1=B，不需步驟 1 產出）
  - A：登記者自選位置（任何 URL，例如 GitHub release、Hugging Face、Zenodo），揭露包記錄 URL 與 hash——取捨：零保存成本、不託管；連結失效時狀態頁只能顯示「檔案取不到」。（建議：S9 已說保存需另行處理，先不承擔保存）
  - B：內容定址儲存（IPFS pinning 或 Arweave）——取捨：位置由 hash 決定、較耐久；需要 pinning 或一次性費用，對大型資料集不實際。
  - C：營運者託管——取捨：體驗最好；營運者成為單點並承擔費用與內容責任，與 S17 相衝。
  - 結論：A，登記者自行保存揭露內容，揭露包記錄 URL 與 hash；ADR：待整理。
- **D8 狀態列舉與語意：揭露期限與終止**（狀態：已決 2026-10-01，Will；擋住步驟：無（已決）；影響步驟：6、7、8；需要的事實：D3、D4 的結論，步驟 4）
  - A：manifest 必填揭露期限；狀態列舉為「尚未揭露／逾期未揭露／已揭露（一致）／已揭露（不一致）／揭露檔案取不到／終止」；終止由登記者送一筆終止交易（metadata 或合約動作）——取捨：讀者可區分進行中與放棄（R18）；登記者要多一筆交易。（建議）
  - B：期限選填，終止只在揭露包內聲明；列舉同 A 去掉「逾期未揭露」——取捨：登記簡單；「尚未揭露」可能無限期，削弱 S6 的目的。
  - C：無期限、無終止動作，只有「尚未揭露／已揭露」——取捨：最簡單；與 S6 的三種狀態不符。
  - spike 3 發現：若揭露期限只在加鹽後的私密 manifest，揭露前無法核對期限。選 A 時須一併決定期限的公開且可驗證位置，並同步改寫 I3 payload 白名單與步驟 6、8 驗收；見 `spike-canonical.md`。
  - 結論：揭露期限選 A，登記時必填並固定，期限前未揭露為「尚未揭露」，期限後未揭露為「逾期未揭露」；公開位置選 A，manifest 必填 `reveal_deadline` 並參與 commitment hash，登記交易 metadata 同步公開 `reveal_deadline`，揭露核對要求兩處一致；終止選 A，由同一登記者錢包身分簽署一筆 metadata 終止交易並引用原 commitment tx hash，保留原 commitment 與歷史；終止後揭露選 A，允許補揭露並獨立核對一致／不一致，主狀態仍為「已終止」，保留補揭露核對結果與事件歷史；逾期補揭露選 A，主狀態為已揭露（一致／不一致），另保留「逾期揭露」標記；已終止時仍依前述終止優先規則。揭露時間選 A：同一登記者簽署鏈上揭露公告，包含原 commitment tx hash、揭露包 hash 與 URL，以公告區塊時間判定按期／逾期；不以自述時間或服務首次讀取時間判定。公告不證明檔案當時可取得；目前可取得性另核對。狀態採尚未揭露／逾期未揭露／已揭露（一致）／已揭露（不一致）／揭露檔案取不到／已終止，並保留公告時間、是否逾期、核對結果與事件歷史；ADR：待整理。
- **D9 讀取與索引的資料來源**（狀態：已決 2026-10-01，Will；擋住步驟：無（已決）；影響步驟：5、6、8；需要的事實：步驟 4；與 D2 相關）
  - A：第三方 API（已選 Koios Public，E4），`ChainReader` 可換——取捨：零營運；受額度與第三方可用性限制。（建議：MVP 量級在免費層內，且 I4 讓 verifier 不綁定單一來源）
  - B：自架（db-sync、Ogmios＋Kupo、Oura，E5）——取捨：不依賴第三方；需要節點主機與維運成本。
  - C：兩者並存：狀態頁用第三方 API，verifier 文件提供自架讀取方式——取捨：成本與獨立性兼顧；兩套 adapter 的測試成本。
  - 結論：策略 A，第三方 API 與可替換的 `ChainReader`；主要提供者選 Koios Public（免 key），本輪三類查詢成功；讀取方式選 A，同源 read proxy＋共用索引快取；proxy 僅接受白名單公開查詢（label、tx hash、地址與分頁），不接收未揭露 manifest 或 salt。快取保存鏈資料／事件，狀態由 `derive_status` 重算；增量同步需排序、去重、watermark、重疊重掃與 rollback 處理，限制查詢與上游 request 用量。不在 MVP 維護自架 adapter；ADR：待整理。
- **D10 網路與成本上限**（狀態：已決 2026-10-01，Will；擋住步驟：無（已決）；影響步驟：6、9（不含 mainnet 準備）；需要的事實：步驟 2）
  - A：MVP 全程只用 preprod／本機 devnet，mainnet 延後——取捨：零成本、格式可升版（依「格式版本規則」前提，已用版本的向量保留）；可展示操作與核對流程，但測試網／本機 devnet 可重置，不能當作 mainnet 的永久承諾。（建議：先不凍結格式）
  - B：MVP 結束時上 mainnet——取捨：真實可核對；需要真實 ADA、格式依 I1 凍結、上線後相容性規則生效。
  - 同題要定：每筆 commitment 的成本上限與誰出（依 D4）。
  - 結論：A，MVP 僅用 preprod／本機 devnet，mainnet 延後；每筆 commitment 交易費硬上限 300000 lovelace（0.3 測試 ADA），不含轉帳本金／託管費；超過就停止送出，不自動放寬。付款者依 D4=A 為登記者；ADR：待整理。
- **D11 技術棧（語言與鏈下函式庫）**（狀態：已決 2026-10-01，Will；擋住步驟：無（已決）；影響步驟：5；需要的事實：D2 的結論、步驟 3）
  - A：Python（PyCardano）——取捨：與 AI 評測工具鏈同語言，CLI／函式庫最自然；網頁與 CIP-30 錢包整合需另一語言。（建議：若 D2 選 A 或 C）
  - B：TypeScript（Mesh 或 Lucid Evolution）——取捨：CLI、網頁與 CIP-30 同一語言；與 Python 為主的 AI 使用者距離較遠。（建議：若 D2 選 B）
  - C：Python CLI／verifier＋TypeScript 網頁，共用 `test-vectors.json`——取捨：各端最合適；兩套實作與兩套 CI。
  - 結論：語言選 B，TypeScript 統一實作網頁、錢包整合與 verifier；鏈下函式庫選 Mesh；ADR：待整理。
- **D12 metadata label 與 CIP-10 註冊**（狀態：已決 2026-10-01，Will；擋住步驟：無（已決）；影響步驟：6、8；需要的事實：步驟 2、4（碰撞情況）；D3 選 B 時本題只決定終止交易等輔助 metadata 是否需要 label）
  - A：選一個未使用的 label 並向 CIP-10 registry 提 PR 註冊——取捨：降低與其他應用碰撞、讀者可查到用途；需要對外部 repo 開 PR（對外動作），等待合併時間不定。（建議：mainnet 前完成；testnet 可先用同一 label）
  - B：使用未註冊的 label——取捨：零外部依賴；碰撞時索引會混入無關交易，`derive_status` 要能過濾不合格式的資料。
  - C：沿用通用的訊息 label（例如 CIP-20 的 674）並在內容加前綴——取捨：不用註冊；label 下交易量大，索引成本高、碰撞與偽造格式更多。
  - spike 4 事實：123456789 在 mainnet／preprod 均已使用；CIP-10 保留 65536–131071 為 private use。新增 D：MVP 測試網使用 private-use 暫用 label，mainnet 前再查碰撞並決定正式註冊；需嚴格 app／版本／網路／schema 過濾，不能宣稱唯一。建議 D；見 `spike-indexing.md`。
  - 結論：D，MVP 測試網使用 CIP-10 private-use 範圍 65536–131071 的暫用 label；具體數字於步驟 6 前查 registry 與鏈上使用後選定，嚴格過濾 app／版本／網路／schema。mainnet 前再查碰撞並決定正式註冊；本次不授權對外 PR；ADR：待整理。

拍板順序：
1. 現在可拍：P-授權（前提，不是決定題，但擋住所有步驟）與 D1（不依賴其他題）。
2. D1 選 A 或 C 時，步驟 1 完成後交 D2；D1 選 B 時，D2 可與 D1 同時拍。
3. D2 拍板後交 D7；D11 等 D2 與步驟 3 都有結果再交。
4. 步驟 2 完成後交 D3、D4、D10（互相影響，同一批交出）；步驟 4 完成後交 D12。
5. 步驟 3 完成後交 D5、D6（同一批）。
6. D3、D4 拍板且步驟 4 完成後交 D8、D9。
P-授權已確認；Will 指示先執行步驟 2、3（產出事實，不是產品程式碼）。D1=B、D2=B、D7=A 已決；步驟 2、3 已完成；D3=A、D4=A、D10=A（每筆 fee 上限 0.3 測試 ADA）已決；D5、D6、D11（TypeScript＋Mesh）已決。步驟 4 依公開樣本範圍完成，D12=D 已決，D8 已決（期限必填、公開期限、鏈上終止／揭露公告及狀態語意），D9 已決（Koios Public＋可替換 ChainReader＋同源 read proxy／共用索引快取）。12 題決定皆已拍板；LICENSE 已確認 MIT，ADR 待集中整理。

## 進度

狀態值：未開始／進行中／程式完成待驗收／完成；D1=B 時步驟 1 標為跳過。

| 步驟 | 狀態 | 已跑的驗收 | 未跑的驗收與原因 | commit |
|---|---|---|---|---|
| 1 產品風險驗證 | 跳過（D1=B） | 不適用 | 未進行需求驗證，依 Will 決定以發布驗證 | |
| 2 Spike：鏈上承諾 | 完成 | devnet tx `8c2afcfa…`；348 bytes、175269 lovelace、2.825 秒包含、3.341 秒讀回；hash 相同；金鑰忽略規則通過，見 spike-chain.md | preprod/mainnet、合約與批次未測（非本機驗收範圍）；未跑公網 finality | `1cb5d5b` |
| 3 Spike：正規化與 hash | 完成 | 66 向量：60 組 bytes/hash 一致、6 組同拒絕；key 順序與值變更各 6 組通過，見 spike-canonical.md | 無；不包含產品 schema 或 Merkle proof 驗收 | `1cb5d5b` |
| 4 Spike：讀取與索引 | 完成（Will 選公開樣本範圍） | Koios 三類查詢、分頁尾頁成功；兩網路 123456789 碰撞；Blockfrost 無 key 三端點 403；見 spike-indexing.md | Blockfrost 成功讀取、自家 preprod 索引延遲、CORS 與熱門 label 全歷史排序未驗；後續按選定來源補 | `1cb5d5b` |
| 5 Walking skeleton | 完成 | 本機與 [Linux CI](https://github.com/Will413028/cardano-ai-preregistry/actions/runs/36868041395) 的 lint／TypeScript＋build、26 unit、4 Chromium e2e、2 mutation 通過；本機 read-only Koios smoke、桌面／375px 檢視通過 | 真實 CIP-30／metadata、Koios adapter／索引屬後續步驟；見 walking-skeleton.md | `1cb5d5b` |
| 6 切片：登記 | 未開始 | | | |
| 7 切片：揭露與核對 | 未開始 | | | |
| 8 切片：狀態介面 | 未開始 | | | |
| 9 硬化 | 未開始 | | | |
| 10 收尾 | 未開始 | | | |

## 壓力測試紀錄

2026-10-01，一個未參與撰寫的唯讀 subagent 以 phase-plan 的審查提示詞原文檢查草稿，回報 14 項（高 4、中 9、低 1）。處理如下。

| # | 發現（摘要） | 嚴重度 | 處理 |
|---|---|---|---|
| 1 | 缺「是否已授權實作或技術探索」前提，步驟 2–4 卻寫成不受擋 | 高 | 改：新增前提 P-授權（未確認），擋住步驟 1–9，拍板順序列為第一項 |
| 2 | 步驟 5 用到格式卻沒被 D5、D6 擋；I2 預先定了串接加鹽的結構；向量缺 domain tag 與版本 | 高 | 改：步驟 5 加擋 D5、D6；I2 改成只要求可重現，構造移入 D6（新增 HMAC、Merkle 選項）；步驟 3 的向量加 domain tag、版本、網路欄位 |
| 3 | 步驟 5–7 寫死 D2=A、D3=A 的形狀 | 高 | 改：入口改為「依 D2」，步驟 5 加 D2 形態不符時先改寫的停止條件，步驟 6 加 D3 選 B 時拆子步驟的停止條件 |
| 4 | 計畫與產出的落點、驗收指令路徑、受訪者個資 | 高 | 改：檔頭寫明位於 `docs/plans/`、指令從 repo 根目錄執行並改用完整路徑；全域約束與步驟 1 加匿名化與同意 |
| 5 | 產生金鑰的步驟早於 `.gitignore` 的金鑰規則 | 中 | 改：步驟 2 範圍先改 `.gitignore`，驗收加 `git check-ignore`；全域約束同步 |
| 6 | 步驟 2「各送一筆」語意不明；spike 選語言等於預選 D11 | 中 | 改：寫明「至少一個網路，兩者可用時都送」；新增前提「spike 語言不約束 D11」 |
| 7 | label 選定與 CIP-10 註冊沒有列決定題 | 中 | 改：新增 D12，擋住步驟 6、8；收尾的需要人做的事加 CIP-10 註冊 |
| 8 | 步驟 3 的 testnet 凍結與 D10 的「可隨意改格式」矛盾 | 中 | 改：新增「格式版本規則」前提，步驟 3、D10 引用同一規則 |
| 9 | integration 與第三方 adapter 是否在 CI 不明；「不含任何 bytes」無法判定 | 中 | 改：分 `make check`（離線、CI）與 `make integration`；I3 改成 payload 欄位白名單＋不含 salt 序列；CI secret 列入需要人做的事 |
| 10 | 「commitment 晚於宣稱時間」沒有可比對的欄位 | 中 | 改：刪除該測試，改成 testnet 冒充 mainnet 的測試；「是否帶宣稱執行時間」併入 D6；驗證邊界加「執行時間」 |
| 11 | D1=C 的進入條件、LICENSE 擋所有 push、push 前核對帳號 | 中 | 改：步驟 5 補 D1=C 條件；全域約束寫明任何 push 都被 LICENSE 擋並核對 remote、帳號、分支 |
| 12 | 本機個人脈絡檔不存在；主清單項目由誰關閉 | 中 | 部分改：收尾步驟與決定段加「拍板與收尾時更新主清單對應項」。駁回「上層改指向主清單路徑」：主清單在私人筆記，公開 repo 不寫其路徑；本機脈絡檔由 repo 擁有者建立並加指向 |
| 13 | 漏列 salt 唯一、網路標示兩條不變量；狀態列舉未定案 | 中 | 改：新增 I8、I9 與對應測試及 mutation；狀態列舉併入 D8 各選項 |
| 14 | I5 測試二選一未定；`rg "status"` 過寬；風險 3 成立時沒有路徑 | 低 | 改：I5 定為路由表斷言＋重算比對兩項；消費端改用具體符號；步驟 1 停止條件加風險 3 |
