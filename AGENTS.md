# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## ビルド・開発コマンド

```bash
# 開発サーバー起動（Tauri + Vite）
bun tauri dev

# プロダクションビルド
bun tauri build --config src-tauri/tauri.release.conf.json

# フロントエンドのみビルド
bun run build

# Rustのみビルド確認
cd src-tauri && cargo build

# Rustの型チェック（ビルドより高速）
cd src-tauri && cargo check

# 環境確認
bun tauri info
```

ツールチェーン管理は `mise.toml`（bun latest, rust latest）。`MACOSX_DEPLOYMENT_TARGET=10.15`。

Rustのplatform features: macOSは `metal`、Linuxは `cuda` が利用可能（`Cargo.toml` の `[features]`）。

テスト・lint・CIは未整備（eslint/biome/clippy/GitHub Actions なし）。

---

## アーキテクチャ

Tauri v2 デスクトップアプリ。Rustバックエンド + React/TypeScriptフロントエンド。

### データフロー

```
Frontend → invoke() → Tauri Command → Backend（同期/非同期）
Backend  → emit()   → Event        → Frontend listener（listen()）
```

フロントエンドからの操作は `@tauri-apps/api` の `invoke()` でRustコマンドを呼び出し、バックエンドからの非同期通知は `listen()` でイベントを受け取る。

### バックエンド（`src-tauri/src/`）

| モジュール | 役割 |
|---|---|
| `lib.rs` | AppState定義、Tauriコマンド登録（35+コマンド）、プラグイン設定 |
| `commands.rs` | Tauriコマンド実装（ファイル操作、AI、Git、グラフ分析） |
| `config.rs` | `~/.config/nomos/config.toml` の読み書き |
| `database.rs` | SQLite操作（embedding保存・類似検索、活動ログ、週次サマリ） |
| `vault.rs` | Vault内ファイル一覧・読み書き |
| `ai.rs` | Ollama連携（embedding生成、Gemma推論） |
| `vertex_ai.rs` | Vertex AI (Gemini API) JWT認証・呼び出し |
| `bibtex.rs` | BibTeXパース・論文紐付け |
| `git.rs` | gitoxide連携（status, stage, commit, log, diff） |
| `watcher.rs` | ファイル変更監視（notify crate） |
| `terminal.rs` | PTY端末（portable-pty + xterm.js） |
| `memory_budget.rs` | メモリ使用量制限 |

**AppState**（`lib.rs`）: `Arc<RwLock<Config>>`, `Arc<Database>`, `Arc<Mutex<Option<CandleState>>>` を保持。

### フロントエンド（`src/`）

グローバルstate管理ライブラリ（Redux/Zustand/Context）は未使用。すべてReact hooksでローカル管理。設定は `localStorage` に永続化。

#### 主要コンポーネント（`src/components/`）

| ファイル | 役割 |
|---|---|
| `App.tsx` | メインレイアウト（サイドバー、エディタペイン、右パネル、ターミナル） |
| `Editor.tsx` | CodeMirror 6エディタ |
| `EditorPane.tsx` | タブ管理 |
| `MarginPanel.tsx` | Judgement Brain マージン注釈UI |
| `GraphPanel.tsx` | Cytoscape.jsグラフ可視化 |
| `GitPanel.tsx` / `GitDiff.tsx` | Git操作UI |
| `AiChatPanel.tsx` | AIチャットインターフェース |
| `TerminalPanel.tsx` | PTYターミナル |
| `SettingsPanel.tsx` | 設定画面 |

#### Hooks（`src/hooks/`）

| フック | 役割 |
|---|---|
| `useVault.ts` | ファイル操作（一覧・開く・保存・作成・削除・リネーム） |
| `useGit.ts` | Git操作 |
| `useAI.ts` | LLM連携（モデル読込・テキスト生成・イベントストリーミング） |
| `useSettings.ts` | localStorage永続化設定（テーマ、フォントサイズ） |
| `useGraphAnalysis.ts` | グラフ分析 |
| `useNotifications.ts` | トースト通知 |
| `useAppMenu.ts` | アプリメニュー連携 |

#### CodeMirror拡張（`src/extensions/`）

- `wikilinks.ts` — `[[link]]` 構文のデコレーションプラグイン
- `wordCompletion.ts` — 単語補完

### AIアーキテクチャ（3層構造）

```
Layer 1: Embedding（常時） — nomic-embed-text、保存のたびにベクトル化、マージン注釈の類似検索
Layer 2: 1B推論（バックグラウンド） — Gemma 3 1B (CPU)、矛盾検出・論文紐付け・週次サマリ
Layer 3: 拡張推論（ユーザー設定） — Ollama経由で大型モデル、Vertex AI (Gemini) でグラフ分析
```

**設計判断**: リアルタイム注釈はembeddingのみ、LLM推論はブロッキングしない。

### DB設計（SQLite `~/.local/share/nomos/nomos.db`）

- `note_embeddings` — ファイルパス、768次元ベクトル（BLOB）、コンテンツハッシュ
- `activity_log` — ファイルパス、アクション、タイムスタンプ、滞在時間
- `weekly_summaries` — 週識別子、サマリ内容、生成日時
- `wikilinks` — ソース、ターゲット、broken フラグ
- `contradiction_cache` — JSON結果、1時間TTL

---

## 運用ルール

- **回答言語**: 日本語
- **ローカルファースト**: 外部依存を最小化し、データ所有権・プライバシーを最優先
- **小さく確実に**: PR/コミットは小さく、差分の理由が追える単位にする。
- **不明点が出た場合**: 実装で補完せず、`.issues/` に記録する。
- **コミットメッセージ**: 短く（例: `feat: add vault watcher` / `fix: resolve 429 error`）。`docs:` / `feat:` / `fix:` / `refactor:` を使い分ける

## 課題管理

- `.issues/` に1ファイル1課題で管理（問題＋やることを1ファイルに記述）
- `.issues/editor/` にエディタ関連の課題
- 変更は「どのissueを解決するか」を明示する