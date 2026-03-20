# AI Agents 運用ルール（このリポジトリ）

このドキュメントは、AIエージェントが本リポジトリで開発を進めるための **共通運用ルール** です。

---

## 基本原則

- **ローカルファースト**: 外部依存を最小化し、データ所有権・プライバシーを最優先する。
- **小さく確実に**: PR/コミットは小さく、差分の理由が追える単位にする。
- **不明点が出た場合**: 実装で補完せず、`.issues/` に記録する。

---

## プロジェクト概要

「自分のデジタルツインをローカルで育てるエディタ」— **Obsidianの完全置き換え** を目指すローカルファーストのナレッジエディタ。

### 技術スタック

| 層 | 技術 |
|---|---|
| シェル | Tauri v2 |
| フロントエンド | TypeScript + React |
| エディタコア | CodeMirror 6 |
| バックエンド | Rust |
| ローカルLLM | Gemma 3 1B GGUF（llama-cpp-2 / Ollama） |
| Embedding | nomic-embed-text（Ollama経由） |
| グラフ分析 | Google Vertex AI（Gemini API） |
| DB | SQLite（rusqlite） |
| Git | gitoxide |

### AIアーキテクチャ（3層構造）

```
Layer 1: Embedding（常時）
  └─ nomic-embed-text — 保存のたびにベクトル化
  └─ マージン注釈のリアルタイム類似検索に使用

Layer 2: 1B推論（オンデマンド・バックグラウンド）
  └─ Gemma 3 1B (CPU動作)
  └─ 矛盾検出・論文紐付け・週次サマリ

Layer 3: 拡張推論（ユーザー設定）
  └─ ModelBackend traitで任意モデルに切り替え
  └─ Ollama経由で大型モデルも可
```

**設計判断**: リアルタイム注釈はembeddingのみ、Gemma推論はブロッキングしない。

### Judgement Brain（マージン注釈）

| アイコン | 種類 | トリガー |
|---|---|---|
| 💡 | 関連過去ノート | embedding類似度が閾値超（cosine > 0.7） |
| ⚡ | 矛盾・一致の指摘 | Gemma推論（2秒アイドル後、1時間キャッシュ） |
| 📄 | 論文・文献との紐付け | BibTeXメタデータ + キーワードマッチ |
| 📊 | 週次サマリ | Gemma週次バッチ生成 |

### Graph Panel（階層構造可視化）

Vertex AI (Gemini API) を使った3フェーズ処理:
1. **キーワード抽出** — 5ファイルずつバッチでGeminiに渡し、各ファイルから3〜5個のキーワード抽出
2. **グルーピング** — キーワード類似性で4〜8グループに分類
3. **階層化** — グループを2つのトップグループにまとめ、日本語ラベル付与

Cytoscape.js + dagre レイアウトで可視化。ファイルノードクリックでエディタに遷移。

### DB設計（SQLite主要テーブル）

- `activity_log` — ファイルパス、アクション（open/edit/close）、タイムスタンプ、滞在時間
- `note_embeddings` — ファイルパス、768次元ベクトル（BLOB）、コンテンツハッシュ
- `weekly_summaries` — 週識別子、サマリ内容、生成日時
- `wikilinks` — ソース、ターゲット、broken フラグ
- `contradiction_cache` — JSON結果、1時間TTL

### 設定ファイル

```
~/.config/nomos/config.toml    # vault path, AI設定, Git設定
~/.local/share/nomos/nomos.db  # SQLite DB
```

---

## 作業フロー

### 1) 課題の確認
- `.issues/` を確認し、対象の課題を把握する

### 2) タスク化
- `.tasks/` に作業項目を作成し、対応するissueを紐付ける

### 3) 実装
- 変更は「どのissue/taskを解決するか」を明示する
- 破壊的変更は、まず `.issues/` に代替案とトレードオフを記録してから着手する

### 4) 検証
- 可能な範囲で最小の再現・検証（lint / build / unit）を行う
- 既存エラーの「巻き込み修正」は原則しない（必要なら別issue化）

---

## コミュニケーション規約

- **回答言語**: 日本語
- **記述スタイル**:
  - 重要事項は **太字** で明示
  - ファイル名・関数名・ディレクトリはバッククォートで囲う（例: `src-tauri/src/ai.rs`）

---

## コミット運用

- **コミットメッセージは短く**（例: `docs: restructure project docs` / `feat: add vault watcher`）
- ドキュメント更新は `docs:`、実装は `feat:` / `fix:` / `refactor:` を使う

---

## タスク管理

- **課題（何が問題か）**: `.issues/` に1ファイル1課題で管理
- **作業項目（何をするか）**: `.tasks/` に1ファイル1タスクで管理
- 各タスクは対応するissueを参照する
