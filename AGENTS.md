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

Rustのplatform features: macOSは `metal`、Linuxは `cuda` が利用可能（`Cargo.toml` の `[features]`）。

---

## アーキテクチャ

Tauri v2 デスクトップアプリ。Rustバックエンド + React/TypeScriptフロントエンド。

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

| ファイル | 役割 |
|---|---|
| `App.tsx` | メインレイアウト（サイドバー、エディタペイン、右パネル、ターミナル） |
| `components/Editor.tsx` | CodeMirror 6エディタ |
| `components/MarginPanel.tsx` | Judgement Brain マージン注釈UI |
| `components/GraphPanel.tsx` | Cytoscape.jsグラフ可視化 |
| `components/GitPanel.tsx` | Git操作UI |
| `hooks/useVault.ts` | ファイル操作フック |
| `hooks/useGit.ts` | Git操作フック |
| `hooks/useAI.ts` | AI推論フック |
| `lib/editorThemes.ts` | CodeMirrorカスタムテーマ定義 |
| `types/index.ts` | 共通型定義（GraphNode, GraphEdge等） |

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
