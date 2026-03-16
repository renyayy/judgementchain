# Nomos 仕様書

> 自分の思考の蓄積を、ローカルLLMで生きた知識に変えるエディタ

**バージョン:** 0.1.0  
**作成日:** 2026-03-16  
**ステータス:** 設計中

---

## 1. コンセプト

### 一言で言うと

「自分のデジタルツインをローカルで育てるエディタ」

外部APIに一切依存せず、自分の思考の蓄積からローカルLLMが自己理解を深めるアシスタントとして機能する。情報が入ってきて（ブラウジング）→溜まって（メモ・論文）→つながって（AI）→出力される（エディタ・コーディング）という一連のフローを一つの環境で完結させる。

### 既存ツールとの関係

- **Obsidianの完全置き換え**を目指す毎日使うメインツール
- 既存のObsidianvaultをそのまま読み書き可能（互換性維持）
- ローカルファイルシステムを直接操作

### 設計哲学

- 外部サービスへの依存ゼロ（推論含めすべてローカル）
- 理解の負荷にならないUI（気づいたら情報がある、という体験）
- データは自分のもの（すべてローカルのファイルとSQLite）
- モデルはプラガブル（特定のLLMに縛られない）

---

## 2. ユースケース

| カテゴリ | 具体的な用途 |
|---|---|
| 研究・論文管理 | BibTeX管理、文献との思考の紐付け、引用追跡 |
| 日常メモ・PKM | デイリーノート、バックリンク、思考の蓄積 |
| コーディング | LSP統合、コードブロック編集、Git連携 |
| ブラウジング・情報収集 | ブラウザ履歴の取り込み、Webクリップ（将来） |

---

## 3. 機能一覧

### 3.1 エディタ（Editor Core）

- Markdown編集（CommonMark準拠）
- シンタックスハイライト（コードブロック対応）
- LSP統合（コーディング用途）
- ファイルツリー表示・ナビゲーション
- Obsidian互換のwikiリンク `[[ノート名]]`
- バックリンク表示
- タグ・フォルダ管理

### 3.2 Vault管理

- ローカルファイルシステムの直接読み書き
- 複数Vault対応（config.tomlで切り替え）
- Obsidian既存vaultとの完全互換
- ファイル変更の自動監視（他ツールとの共存）

### 3.3 Git連携

- 編集時の自動commit（設定でON/OFF可能）
- diff表示
- 履歴ブラウズ
- gitoxide（Rust実装のlibgit）を使用

### 3.4 Judgement Brain（中核機能）

#### UIデザイン：マージン注釈型

エディタ右マージンに薄く表示される。書いている最中に自然に気づく設計。

```
┌──────────────────────────┬──────────────────┐
│ 今日の思考...            │ ┊ 💡 2024/09に    │
│                          │ ┊ 同じ問いあり    │
│ 自分の強みは抽象化能力   │ ┊                 │
│ にあると思う。           │ ┊ ⚡ 矛盾:        │
│                          │ ┊ 12/03「具体性   │
│                          │ ┊ が強み」と記録  │
│                          │ ┊                 │
│                          │ ┊ 📄 関連論文:    │
│                          │ ┊ Sweller 1988   │
└──────────────────────────┴──────────────────┘
```

#### 注釈の種類

| アイコン | 種類 | トリガー |
|---|---|---|
| 💡 | 関連過去ノート | embedding類似度が閾値超 |
| ⚡ | 矛盾・一致の指摘 | Gemma推論（バックグラウンド） |
| 📄 | 論文・文献との紐付け | BibTeXメタデータ + embedding |
| 📊 | 強み・弱みサマリへのリンク | 週次バッチ生成 |

#### Gemmaにやらせること

1. 今の思考に関連する過去ノートの提示
2. 行動ログから習慣・パターンの分析
3. 論文・文献との自動紐付け
4. 過去ノートとの矛盾・一致の指摘
5. 強み・弱みの定期サマリ生成

### 3.5 検索（優先度低・Phase 4以降）

- tantivyによる全文検索
- embeddingによるセマンティック検索
- ブラウザ履歴の取り込み
- 行動ログ統合検索

---

## 4. 技術スタック

| 層 | 技術 | 理由 |
|---|---|---|
| シェル | Tauri v2 | クロスプラットフォーム、ネイティブFS直接操作 |
| フロントエンド | TypeScript + React | CodeMirror 6との親和性 |
| エディタコア | CodeMirror 6 | 拡張性、パフォーマンス |
| バックエンド | Rust | 推論・ファイルIO・Git操作の安定性 |
| ローカルLLM | Gemma 3 1B GGUF（llama-cpp-2クレート経由） | CPUで動作、Q4_K_M量子化で600MB程度 |
| Embedding | nomic-embed-text（軽量） | リアルタイム類似検索用 |
| DB | SQLite（rusqlite） | 行動ログ・メタデータ管理 |
| 全文検索 | tantivy | Rust製、高速 |
| Git操作 | gitoxide | Pure Rust実装 |

---

## 5. AI推論アーキテクチャ

### 3層構造

```
Layer 1: Embedding（常時）
  └─ nomic-embed等の軽量モデル
  └─ 保存のたびにベクトル化
  └─ マージン注釈のリアルタイム類似検索に使用

Layer 2: 1B推論（オンデマンド・バックグラウンド）
  └─ Gemma 3 1B (CPU動作)
  └─ 矛盾検出・論文紐付け
  └─ ユーザーからの明示的な質問

Layer 3: 拡張推論（ユーザー設定）
  └─ ModelBackend traitで任意モデルに切り替え
  └─ 深いサマリ・分析
  └─ Ollama経由で大型モデルも可
```

### ModelBackend trait設計

```rust
pub trait ModelBackend: Send + Sync {
    fn generate(&self, prompt: &str) -> anyhow::Result<String>;
    fn embed(&self, text: &str) -> anyhow::Result<Vec<f32>>;
    fn model_name(&self) -> &str;
}

// デフォルト実装：llama-cpp-2クレート経由
// モデル：Gemma 3 1B GGUF (Q4_K_M量子化)
// HuggingFaceから取得: bartowski/gemma-3-1b-it-GGUF
pub struct LlamaCppBackend {
    model: llama_cpp_2::model::LlamaModel,
    model_path: PathBuf,
}

// 拡張実装：Ollama経由（大型モデル・別マシン推論用）
pub struct OllamaBackend {
    base_url: String,  // デフォルト: http://localhost:11434
    model: String,
}
```

config.tomlでモデルを切り替え可能にする。

### 重要な設計判断

**リアルタイム注釈はembeddingのみ、Gemma推論はブロッキングしない。**

書きながら使うマージン注釈は、事前に生成したembeddingベクトルの類似検索で処理する。Gemmaの本推論はバックグラウンドスケジューラと明示的な質問に限定する。これがCPU動作でも快適に使える鍵。

---

## 6. データ設計

### ファイル構造

```
~/.config/nomos/
  config.toml          # vault path, モデル設定など

~/vault/               # Obsidian互換のvault（任意の場所）
  *.md
  .obsidian/           # 既存Obsidian設定（読み取りのみ）

~/.local/share/nomos/
  nomos.db             # 行動ログ・メタデータ・embeddings
  models/              # LLMモデルファイル
  index/               # tantivyインデックス
```

### SQLiteスキーマ（主要テーブル）

```sql
-- 行動ログ
CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY,
    file_path TEXT,
    action TEXT,          -- 'open' | 'edit' | 'close'
    timestamp INTEGER,
    duration_sec INTEGER
);

-- ノートのembedding
CREATE TABLE note_embeddings (
    file_path TEXT PRIMARY KEY,
    embedding BLOB,       -- Vec<f32>をシリアライズ
    updated_at INTEGER
);

-- 週次サマリ
CREATE TABLE weekly_summaries (
    week TEXT PRIMARY KEY, -- 'YYYY-WNN'
    content TEXT,
    generated_at INTEGER
);
```

---

## 7. ディレクトリ構造

```
nomos/
├── src-tauri/
│   ├── src/
│   │   ├── ai/
│   │   │   ├── backend/
│   │   │   │   ├── mod.rs         # ModelBackend trait
│   │   │   │   ├── llamacpp.rs    # llama.cpp（デフォルト）
│   │   │   │   └── ollama.rs      # Ollama（拡張）
│   │   │   ├── embedding.rs       # ベクトル化
│   │   │   ├── scheduler.rs       # バックグラウンド推論
│   │   │   └── judgement.rs       # Brain本体ロジック
│   │   ├── vault/
│   │   │   ├── fs.rs              # ファイル読み書き
│   │   │   ├── git.rs             # gitoxide連携
│   │   │   └── watcher.rs         # ファイル変更監視
│   │   ├── db/
│   │   │   ├── schema.sql
│   │   │   ├── activity.rs        # 行動ログ
│   │   │   └── search.rs          # tantivy全文検索
│   │   ├── bibtex.rs              # 論文紐付け
│   │   └── main.rs
│   └── tauri.conf.json
└── src/
    ├── editor/
    │   ├── CodeMirror.tsx         # エディタ本体
    │   └── MarginAnnotation.tsx   # Judgement Brain注釈UI
    ├── sidebar/
    │   ├── FileTree.tsx
    │   └── Backlinks.tsx
    └── weekly/
        └── Summary.tsx            # 強み・弱みサマリビュー
```

---

## 8. 開発ロードマップ

### Phase 1：エディタとして使えること

**ゴール：Obsidianの代わりに毎日使えるエディタ**

- [ ] Tauri v2プロジェクト作成
- [ ] CodeMirror 6 + Markdown拡張の組み込み
- [ ] config.tomlでvault pathを指定
- [ ] ファイルツリー表示・選択・表示
- [ ] Markdownファイルの読み書き
- [ ] wikiリンク `[[]]` のシンタックスハイライト
- [ ] gitoxideで変更を自動commit
- [ ] SQLiteへの行動ログ記録開始（Phase 3への仕込み）

### Phase 2：検索と記憶

**ゴール：過去の自分にアクセスできる**

- [ ] tantivyで全文検索
- [ ] Gemma 3 1B のllama.cpp経由での動作確認
- [ ] nomic-embedでnote embeddingの生成・保存
- [ ] マージン注釈UI（関連ノートのみ）の実装
- [ ] ModelBackend traitの整備

### Phase 3：Judgement Brain本体

**ゴール：思考の蓄積から自己理解が生まれる**

- [ ] 矛盾・一致検出ロジック
- [ ] BibTeX読み込みと論文自動紐付け
- [ ] 強み・弱みの週次サマリ生成（バックグラウンド）
- [ ] 習慣・パターン分析

### Phase 4：行動ログ統合・検索強化

**ゴール：情報の入口を統合する**

- [ ] ブラウザ拡張との連携（履歴取り込み）
- [ ] セマンティック検索UI
- [ ] Ollama経由の大型モデル対応

---

## 9. 未決定事項

| 項目 | 選択肢 | 優先度 |
|---|---|---|
| llama.cppのRustバインディング | **llama-cpp-2（確定）**、candle / Ollamaは拡張扱い | ✅ 決定済み |
| Embeddingモデルの選定 | nomic-embed-text / all-MiniLM / Gemma embed | Phase 2開始時に決定 |
| マージン注釈のトリガー閾値 | コサイン類似度 0.75〜0.85 | 実験で調整 |
| ブラウザ拡張の対応ブラウザ | Firefox優先 / Chrome | Phase 4で決定 |

---

## 10. 参考・類似ツール

| ツール | 参考にする点 | しない点 |
|---|---|---|
| Obsidian | vault構造、バックリンク、UIの簡潔さ | プラグインエコシステム（独自実装） |
| Logseq | アウトライン思考 | データベースモード |
| Notion AI | AIの役割（補完より思考整理） | クラウド依存 |
| Rewind | 行動ログの網羅性 | プライバシーの懸念（ローカルで解決） |