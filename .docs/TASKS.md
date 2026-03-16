# TASKS.md（タスク管理・単一ソース）

このファイルはリポジトリ全体の **進捗の単一ソース** です。  
詳細設計・要件は `.kiro/specs/` を参照し、各タスクはSpecの根拠（要件/設計の項目）にリンクします。

---

## 状態定義

- `backlog`: いつかやる（未着手）
- `next`: 直近でやる（着手待ち）
- `in_progress`: 着手中（原則1つ）
- `blocked`: 依存/不明点で停止
- `done`: 完了

---

## ボード（並列実行しやすい分割）

### Meta / Spec 整備

| ID | Status | Feature | Task | Spec link | Done条件（最小） |
|---|---|---|---|---|---|
| T-001 | next | meta | `.kiro/specs/nomos-editor/tasks.md` を作成（Phase 1〜4をさらにタスク分解） | `.kiro/specs/nomos-editor/design.md` | Phaseごとに FE / BE / AI / Infra のタスクに分解されている |

### Phase 1 – Editor / Vault 基本（FE/BE で並列可）

| ID | Status | Feature | Task | Spec link | Done条件（最小） |
|---|---|---|---|---|---|
| T-101 | backlog | nomos-editor-frontend | Tauri v2 + React + CodeMirror 6 の最小起動 | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | ローカルで起動し、プレーンMarkdownを編集できる |
| T-102 | backlog | nomos-editor-frontend | wikiリンク `[[...]]` のシンタックスハイライトとクリック遷移 | `.kiro/specs/nomos-editor/requirements.md` | `[[note]]` が強調表示され、クリックでノートを開ける |
| T-103 | backlog | nomos-editor-frontend | BacklinksパネルのUI実装（ダミーデータでOK） | `.kiro/specs/nomos-editor/design.md` | サイドバーにバックリンク一覧が表示される（まだ本物のデータでなくてよい） |
| T-104 | backlog | nomos-editor-backend | Vault I/O（Markdown読み書き） | `.kiro/specs/nomos-editor/requirements.md` | 指定Vaultからファイルを読み、保存できる |
| T-105 | backlog | nomos-editor-backend | ファイルツリーAPI（一覧 + 作成 + 削除の最低限） | `.kiro/specs/nomos-editor/requirements.md` | 一覧取得・新規作成・削除（trash移動）がAPI経由で動く |
| T-106 | backlog | nomos-editor-backend | ファイル変更監視（外部編集を検出） | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | 外部更新を検知し、フロントに通知できる |

### Phase 1 – Infra / Git / Logging（他と並列可）

| ID | Status | Feature | Task | Spec link | Done条件（最小） |
|---|---|---|---|---|---|
| T-111 | backlog | nomos-editor-infra | config.toml 読み込みとVault/AI/Git設定の反映 | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | `~/.config/nomos/config.toml` を読み、最低限の設定がアプリに反映される |
| T-112 | backlog | nomos-editor-infra | Git自動commit（ON/OFF）とcommitメッセージテンプレート | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | 保存時に自動commitされ、設定でOFFにできる |
| T-113 | backlog | nomos-editor-backend | 行動ログ記録（SQLite: open/edit/close） | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | `activity_log` に操作が非同期で蓄積される |

### Phase 2 – Embedding / 関連ノート（💡）（AI/DB/FEで並列可）

| ID | Status | Feature | Task | Spec link | Done条件（最小） |
|---|---|---|---|---|---|
| T-201 | backlog | nomos-editor-ai | Embeddingエンジン実装（nomic-embed-text想定インターフェース） | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | 文字列を渡すとベクトルが返るモジュールがある |
| T-202 | backlog | nomos-editor-backend | `note_embeddings` テーブルと保存/取得クエリ | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | 指定ファイルのembeddingを保存・取得できる |
| T-203 | backlog | nomos-editor-backend | 類似ノート検索API（top-k, 閾値指定） | `.kiro/specs/nomos-editor/design.md` | embeddingから類似ノート一覧を返すAPIがある |
| T-204 | backlog | nomos-editor-frontend | Margin Annotation（💡）のUIコンポーネント | `.kiro/specs/nomos-editor/design.md` | 右マージンに関連ノートのリストを表示できる（擬似データでOK） |

### Phase 3 – Judgement Brain 本体（⚡📄📊）

| ID | Status | Feature | Task | Spec link | Done条件（最小） |
|---|---|---|---|---|---|
| T-301 | backlog | nomos-editor-ai | Gemma 3 1B (llama.cpp) バックエンド統合（Generateのみ） | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | プロンプトを渡してテキスト応答が返るところまで |
| T-302 | backlog | nomos-editor-ai | 矛盾検出用プロンプト設計とDetectorモジュール | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | 2ノートを渡すと「矛盾の有無＋理由」を返すAPIがある |
| T-303 | backlog | nomos-editor-backend | `contradiction_cache` テーブルとキャッシュ制御 | `.kiro/specs/nomos-editor/design.md` | 指定ノートの矛盾結果をキャッシュ・取得できる |
| T-304 | backlog | nomos-editor-frontend | Margin Annotation（⚡）の表示とノート遷移 | `.kiro/specs/nomos-editor/design.md` | 矛盾がある場合、⚡と共に相手ノートへジャンプできる |
| T-305 | backlog | nomos-editor-backend | BibTeXパーサーと論文リンク検索 | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | BibTeXからエントリを読み込み、ノート内容との関連候補を出せる |
| T-306 | backlog | nomos-editor-frontend | Margin Annotation（📄📊）の表示 | `.kiro/specs/nomos-editor/design.md` | 関連論文と週次サマリのエントリを右マージンに表示できる |


---

## ルール（運用）

- `in_progress` は原則 **1件**（並行する場合は理由を「Task」欄に明記）
- `blocked` になったら、直ちに「Spec link」先へ **Open Questions** を追記する（実装で解釈しない）
- 完了時は「Done条件」を満たした根拠（動作確認・ログ・スクショ等）を「Task」欄に追記する

