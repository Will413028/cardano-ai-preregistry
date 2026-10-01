# 既有先例與待驗證的產品風險

計畫：`../2026-10-01-preregistry-mvp.md`。查詢日期 2026-10-01。

## 既有先例

| 先例 | 證明了什麼 | 不證明什麼 | 來源 |
|---|---|---|---|
| OSF Registrations | 研究計畫可事前固定為唯讀註冊，有 embargo 後公開的流程 | AI 開發者會為評測實驗使用；第三方可不信任 OSF 而核對 | [OSF Registrations](https://help.osf.io/article/330-welcome-to-registrations) |
| AsPredicted | 作者可私密建立、之後產生不可修改的公開版本，並有 Web Archive 備份 | 同上；且版本順序由單一營運者保證 | [AsPredicted](https://www.aspredicted.org/)、[editing prereg](https://aspredicted.org/help/editing_prereg) |
| NeurIPS 2020、2021 pre-registration workshop | ML 社群試過「先審實驗設計、後跑結果」的發表模式，並出版 PMLR 論文集 | 有持續需求（之後未成常設 track 的原因未查）；需要區塊鏈承諾 | [NeurIPS 2020 workshop](https://neurips.cc/virtual/2020/workshop/16158)、[NeurIPS 2021 workshop](https://neurips.cc/virtual/2021/workshop/21885)、[PMLR v148](https://proceedings.mlr.press/v148/)、[PMLR v181](https://proceedings.mlr.press/v181/) |
| Pre-registration for Predictive Modeling（arXiv 2311.18807） | 學界提出把預註冊用在預測模型 | 有工具採用 | [arXiv 2311.18807](https://arxiv.org/pdf/2311.18807) |
| OpenTimestamps、Sigstore Rekor | 對 hash 做公開、不由單一方控制（或可稽核）的時間戳，可免費且大量聚合 | 有實驗登記與狀態追蹤；Cardano 版本的必要性 | 見 `external-interfaces.md` E10 |

結論：事前固定、私密版本、事後公開與公開時間戳都有成熟做法（S8、S11）。本產品的增量只可能在「AI 實驗的 manifest 整合、操作成本、第三方獨立查核、已登記失敗案例的可見性」（S12），目前沒有證據。

## 待驗證的產品風險

| 風險 | 目前證據 | 最便宜的驗證方式（步驟 1，若 D1 選 A） |
|---|---|---|
| 有沒有人要：目標使用者（S1）是否在意「事前承諾可被第三方獨立核對」 | 無；只有研究預註冊的既有需求（OSF、AsPredicted、NeurIPS workshop） | 使用者訪談；公開假門（README 或 landing page 說明＋登記意願） |
| 會不會反覆用：每個評測或實驗都登記的操作成本是否可接受 | 無 | 手動流程：用現成工具（任一 Cardano 錢包送 metadata 交易）替少數使用者登記並觀察是否回來 |
| 是否偏好 Cardano 而非免費替代（OpenTimestamps、Rekor、OSF） | 無；S8 已承認不是 Cardano 獨有能力 | 訪談時並列替代方案詢問 |
| 願不願意付費或投入（含付交易費、管理錢包） | 無具名付費需求（S12） | 訪談；假門上的選項 |
