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


| ID    | Status | Feature | Task                                                        | Spec link                            | Done条件（最小）                                 |
| ----- | ------ | ------- | ----------------------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| T-001 | next   | meta    | `.kiro/specs/nomos-editor/tasks.md` を作成（Phase 1〜4をさらにタスク分解） | `.kiro/specs/nomos-editor/design.md` | Phaseごとに FE / BE / AI / Infra のタスクに分解されている |


### Phase 1 – Editor / Vault 基本（FE/BE で並列可）


| ID    | Status | Feature               | Task                                  | Spec link                                                                         | Done条件（最小）                                                         |
| ----- | ------ | --------------------- | ------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| T-101 | done   | nomos-editor-frontend | Tauri v2 + React + CodeMirror 6 の最小起動 | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | ローカルで起動し、プレーンMarkdownを編集できる                                        |
| T-102 | done   | nomos-editor-frontend | wikiリンク `[[...]]` のシンタックスハイライトとクリック遷移 | `.kiro/specs/nomos-editor/requirements.md`                                        | `src/extensions/wikilinks.ts` にMatchDecoratorで実装。クリックでノートを開ける      |
| T-103 | done   | nomos-editor-frontend | BacklinksパネルのUI実装                     | `.kiro/specs/nomos-editor/design.md`                                              | MarginPanel にバックリンク一覧を表示                                           |
| T-104 | done   | nomos-editor-backend  | Vault I/O（Markdown読み書き）               | `.kiro/specs/nomos-editor/requirements.md`                                        | vault.rs で実装済み                                                     |
| T-105 | done   | nomos-editor-backend  | ファイルツリーAPI（一覧 + 作成 + 削除の最低限）          | `.kiro/specs/nomos-editor/requirements.md`                                        | 再帰的ツリー、trash移動、APIすべて実装済み                                          |
| T-106 | done   | nomos-editor-backend  | ファイル変更監視（外部編集を検出）                     | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | `src-tauri/src/watcher.rs` でnotifyクレートを使用。vault:changedイベントで自動リロード |


### Phase 1 – Infra / Git / Logging（他と並列可）


| ID    | Status | Feature              | Task                                  | Spec link                                                                         | Done条件（最小）                                    |
| ----- | ------ | -------------------- | ------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------- |
| T-111 | done   | nomos-editor-infra   | config.toml 読み込みとVault/AI/Git設定の反映    | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | `~/.config/nomos/config.toml` から読み込み、デフォルト値あり |
| T-112 | done   | nomos-editor-infra   | Git自動commit（ON/OFF）とcommitメッセージテンプレート | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | `save_file`内で`git.auto_commit`フラグを確認し自動commit |
| T-113 | done   | nomos-editor-backend | 行動ログ記録（SQLite: open/edit/close）       | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | `activity_log` テーブルに記録済み                      |


### Phase 2 – Embedding / 関連ノート（💡）（AI/DB/FEで並列可）


| ID    | Status | Feature               | Task                                     | Spec link                                                                         | Done条件（最小）                                                      |
| ----- | ------ | --------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| T-201 | done   | nomos-editor-ai       | Embeddingエンジン実装（Ollama/nomic-embed-text） | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | `src-tauri/src/ai.rs` でOllama API呼び出し。未起動時はgraceful degradation |
| T-202 | done   | nomos-editor-backend  | `note_embeddings` テーブルと保存/取得クエリ          | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | database.rsに実装済み。保存時にバックグラウンドスレッドで自動生成                          |
| T-203 | done   | nomos-editor-backend  | 類似ノート検索API（top-k, 閾値指定）                  | `.kiro/specs/nomos-editor/design.md`                                              | `get_similar_notes_for_margin`コマンドで閾値フィルタ済みの類似ノートを返す            |
| T-204 | done   | nomos-editor-frontend | Margin Annotation（💡）のUIコンポーネント          | `.kiro/specs/nomos-editor/design.md`                                              | MarginPanelに💡アイコン付きで表示。クリックでノートを開ける                            |


### Phase 3 – Judgement Brain 本体（⚡📄📊）


| ID    | Status  | Feature               | Task                                        | Spec link                                                                         | Done条件（最小）                        |
| ----- | ------- | --------------------- | ------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------- |
| T-301 | backlog | nomos-editor-ai       | Gemma 3 1B (llama.cpp) バックエンド統合（Generateのみ） | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | プロンプトを渡してテキスト応答が返るところまで           |
| T-302 | backlog | nomos-editor-ai       | 矛盾検出用プロンプト設計とDetectorモジュール                  | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | 2ノートを渡すと「矛盾の有無＋理由」を返すAPIがある       |
| T-303 | backlog | nomos-editor-backend  | `contradiction_cache` テーブルとキャッシュ制御          | `.kiro/specs/nomos-editor/design.md`                                              | 指定ノートの矛盾結果をキャッシュ・取得できる            |
| T-304 | backlog | nomos-editor-frontend | Margin Annotation（⚡）の表示とノート遷移               | `.kiro/specs/nomos-editor/design.md`                                              | 矛盾がある場合、⚡と共に相手ノートへジャンプできる         |
| T-305 | backlog | nomos-editor-backend  | BibTeXパーサーと論文リンク検索                          | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | BibTeXからエントリを読み込み、ノート内容との関連候補を出せる |
| T-306 | backlog | nomos-editor-frontend | Margin Annotation（📄📊）の表示                  | `.kiro/specs/nomos-editor/design.md`                                              | 関連論文と週次サマリのエントリを右マージンに表示できる       |


---

## ルール（運用）

- `in_progress` は原則 **1件**（並行する場合は理由を「Task」欄に明記）
- `blocked` になったら、直ちに「Spec link」先へ **Open Questions** を追記する（実装で解釈しない）
- 完了時は「Done条件」を満たした根拠（動作確認・ログ・スクショ等）を「Task」欄に追記する

