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

## ボード

| ID | Status | Feature | Task | Spec link | Done条件（最小） |
|---|---|---|---|---|---|
| T-001 | next | nomos-editor | `.kiro/specs/nomos-editor/tasks.md` を作成（Phase 1〜4をタスク分解） | `.kiro/specs/nomos-editor/design.md` | Phaseごとに「成果物」「依存」「受け入れ基準」へ紐付けられている |
| T-002 | backlog | nomos-editor | Phase 1: Tauri v2 + React + CodeMirror 6 の最小起動 | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | ローカルで起動し、Markdown編集ができる最小構成 |
| T-003 | backlog | nomos-editor | Phase 1: Vault I/O（読み書き） + ファイルツリー | `.kiro/specs/nomos-editor/requirements.md` | Vault指定で一覧表示し、ノートを開いて保存できる |
| T-004 | backlog | nomos-editor | Phase 1: wikiリンク解決 + バックリンク表示 | `.kiro/specs/nomos-editor/requirements.md` | `[[...]]` の認識・遷移・バックリンク一覧が動く |
| T-005 | backlog | nomos-editor | Phase 1: Git自動commit（ON/OFF） | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | 保存時に自動commitし、無効化できる |
| T-006 | backlog | nomos-editor | Phase 1: 行動ログ記録（SQLite） | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | open/edit/close が非同期に記録される |
| T-007 | backlog | nomos-editor | Phase 2: Embedding生成・保存・類似検索（💡） | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | 保存でembedding生成し、閾値で関連ノートが出る |
| T-008 | backlog | nomos-editor | Phase 3: 矛盾検出（⚡）のバックグラウンド実行 | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | アイドル時に検出し、UIがブロックされない |
| T-009 | backlog | nomos-editor | Phase 3: BibTeX解析と論文リンク（📄） | `.kiro/specs/nomos-editor/requirements.md` | BibTeXが読み込め、関連論文が表示される |
| T-010 | backlog | nomos-editor | Phase 3: 週次サマリ生成（📊） | `.kiro/specs/nomos-editor/requirements.md` | 週次で生成・保存・閲覧できる |

---

## ルール（運用）

- `in_progress` は原則 **1件**（並行する場合は理由を「Task」欄に明記）
- `blocked` になったら、直ちに「Spec link」先へ **Open Questions** を追記する（実装で解釈しない）
- 完了時は「Done条件」を満たした根拠（動作確認・ログ・スクショ等）を「Task」欄に追記する

