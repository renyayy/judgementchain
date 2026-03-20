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
| T-107 | done   | nomos-editor-frontend | ファイルツリー基本コンテキストメニュー（右クリック）     | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | 右クリックで`開く/新規ノート/新規フォルダ/リネーム/削除/プロパティ`が表示され、CRUD実行後も開いているタブが破綻しない |


### Phase 1 – Infra / Git / Logging（他と並列可）


| ID    | Status | Feature              | Task                                  | Spec link                                                                         | Done条件（最小）                                    |
| ----- | ------ | -------------------- | ------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------- |
| T-111 | done   | nomos-editor-infra   | config.toml 読み込みとVault/AI/Git設定の反映    | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | `~/.config/nomos/config.toml` から読み込み、デフォルト値あり |
| T-112 | done   | nomos-editor-infra   | Git自動commit（ON/OFF）とcommitメッセージテンプレート | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | `save_file`内で`git.auto_commit`フラグを確認し自動commit |
| T-113 | done   | nomos-editor-backend | 行動ログ記録（SQLite: open/edit/close）       | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | `activity_log` テーブルに記録済み                      |
| T-114 | done   | nomos-editor-infra   | 物理メモリの割合でプロセス上限（RLIMIT_AS + モデルロード前チェック） | `.kiro/specs/nomos-editor/design.md`（`[performance]`） | `config.performance.max_system_memory_fraction` 既定 0.8、`memory_budget.rs` |


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
| T-301 | done    | nomos-editor-ai       | Gemma 3 1B (llama.cpp) バックエンド統合（Generateのみ） | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | `ai.rs`にLlamaState実装、`load_model`/`generate_text`コマンド、`useAI`フック、`AiChatPanel`で動作確認済み |
| T-302 | done    | nomos-editor-ai       | 矛盾検出用プロンプト設計とDetectorモジュール                  | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | `ai.rs`に`build_contradiction_prompt`/`parse_contradiction_response`実装。Gemma に2ノートを渡し矛盾の有無＋理由を返す |
| T-303 | done    | nomos-editor-backend  | `contradiction_cache` テーブルとキャッシュ制御          | `.kiro/specs/nomos-editor/design.md`                                              | `database.rs`に`store_contradiction`/`get_contradictions`/`clear_contradictions`実装。TTL 1時間 |
| T-304 | done    | nomos-editor-frontend | Margin Annotation（⚡）の表示とノート遷移               | `.kiro/specs/nomos-editor/design.md`                                              | `detect_contradictions`コマンド実装。保存後2秒アイドルで自動起動。⚡カード赤枠スタイル適用、クリックでノート遷移 |
| T-305 | done    | nomos-editor-backend  | BibTeXパーサーと論文リンク検索                          | `.kiro/specs/nomos-editor/requirements.md` / `.kiro/specs/nomos-editor/design.md` | `bibtex.rs`にパーサー実装。vault内.bibファイルをスキャンしkeyword類似度でtop-3論文を返す |
| T-306 | done    | nomos-editor-frontend | Margin Annotation（📄📊）の表示                  | `.kiro/specs/nomos-editor/design.md`                                              | `get_margin_annotations`に📄・📊を追加。`generate_weekly_summary`コマンドでGemma生成・キャッシュ。MarginPanelで色付き表示 |


---

## ルール（運用）

- `in_progress` は原則 **1件**（並行する場合は理由を「Task」欄に明記）
- `blocked` になったら、直ちに「Spec link」先へ **Open Questions** を追記する（実装で解釈しない）
- 完了時は「Done条件」を満たした根拠（動作確認・ログ・スクショ等）を「Task」欄に追記する

