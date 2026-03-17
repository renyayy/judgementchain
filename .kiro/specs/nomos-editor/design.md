# Nomos 技術設計書

## 概要

Nomosは、ローカルLLMを活用した知識管理エディタです。Obsidianの完全な置き換えを目指しながら、Judgement Brainと呼ばれるマージン注釈システムを通じて、ユーザーの思考の蓄積から自動的に関連情報や矛盾を検出し、自己理解を深めるアシスタント機能を提供します。

### 設計の中核原則

1. **ローカルファースト**: すべてのAI推論がローカルで実行され、外部APIに一切依存しない
2. **パフォーマンス重視**: 大規模vault（10,000ノート）でも快適に動作
3. **プラガビリティ**: ModelBackendトレイトにより、異なるLLMバックエンドに対応可能
4. **Obsidian互換**: 既存vaultの読み書きが可能で、ユーザーの既存資産を活かせる
5. **非ブロッキング設計**: AI推論はバックグラウンドで実行され、エディタの応答性を損なわない

---

## アーキテクチャ概要

### システム全体図

```
┌─────────────────────────────────────────────────────────────────┐
│                        Tauri v2 (Shell)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────────────┐      ┌──────────────────────────┐ │
│  │   Frontend (React)       │      │   Backend (Rust)         │ │
│  │                          │      │                          │ │
│  │ ┌────────────────────┐   │      │ ┌────────────────────┐   │ │
│  │ │ CodeMirror 6       │   │      │ │ Vault Manager      │   │ │
│  │ │ + Markdown         │   │      │ │ (FS + Git)         │   │ │
│  │ └────────────────────┘   │      │ └────────────────────┘   │ │
│  │                          │      │                          │ │
│  │ ┌────────────────────┐   │      │ ┌────────────────────┐   │ │
│  │ │ Margin             │   │      │ │ AI Backend         │   │ │
│  │ │ Annotation Panel   │   │      │ │ (ModelBackend)     │   │ │
│  │ │ (Judgement Brain)  │   │      │ │                    │   │ │
│  │ └────────────────────┘   │      │ └────────────────────┘   │ │
│  │                          │      │                          │ │
│  │ ┌────────────────────┐   │      │ ┌────────────────────┐   │ │
│  │ │ File Tree          │   │      │ │ Database Layer     │   │ │
│  │ │ Backlinks          │   │      │ │ (SQLite)           │   │ │
│  │ └────────────────────┘   │      │ └────────────────────┘   │ │
│  │                          │      │                          │ │
│  └──────────────────────────┘      └──────────────────────────┘ │
│           │                                    │                 │
│           └────────────────────────────────────┘                 │
│                  Tauri IPC Bridge                                │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
         │                                              │
         ▼                                              ▼
    ┌─────────────┐                          ┌──────────────────┐
    │ Local Files │                          │ SQLite Database  │
    │ (Vault)     │                          │ ~/.local/share/  │
    │             │                          │ nomos/nomos.db   │
    └─────────────┘                          └──────────────────┘
         │
         ▼
    ┌─────────────┐
    │ Git Repo    │
    │ (gitoxide)  │
    └─────────────┘
```

### コンポーネント間のデータフロー

```
User Input (Editor)
    │
    ▼
┌─────────────────────────────────────────┐
│ CodeMirror 6 (Frontend)                 │
│ - Markdown parsing                      │
│ - Syntax highlighting                   │
│ - wikilink detection                    │
└─────────────────────────────────────────┘
    │
    ▼ (Tauri IPC)
┌─────────────────────────────────────────┐
│ Vault Manager (Backend)                 │
│ - File I/O                              │
│ - Change detection                      │
│ - Git commit                            │
└─────────────────────────────────────────┘
    │
    ├─────────────────────────────────────┐
    │                                     │
    ▼                                     ▼
┌──────────────────────┐      ┌──────────────────────┐
│ Activity Logger      │      │ Embedding Engine     │
│ (SQLite)             │      │ (Background)         │
└──────────────────────┘      └──────────────────────┘
                                    │
                                    ▼
                              ┌──────────────────────┐
                              │ Margin Annotation    │
                              │ Panel (Frontend)     │
                              │ - Related notes      │
                              │ - Contradictions     │
                              │ - Paper links        │
                              └──────────────────────┘
```

---

## コンポーネント設計

### 1. エディタコア (Editor Core)

**責務**: Markdownファイルの編集、シンタックスハイライト、wikiリンク処理

**実装**: CodeMirror 6 + React

**主要機能**:
- CommonMark準拠のMarkdown編集
- 言語別シンタックスハイライト（コードブロック）
- wikiリンク `[[note_name]]` の認識と装飾
- undo/redo（無制限履歴）
- 自動保存（1秒以内）
- 行番号・カラム表示
- テキスト検索と置換

**インターフェース**:
```typescript
interface EditorState {
  content: string;
  filePath: string;
  isDirty: boolean;
  cursorPosition: { line: number; column: number };
}

interface EditorCommand {
  save(): Promise<void>;
  search(query: string): SearchResult[];
  replace(query: string, replacement: string): void;
  getWikilinks(): WikiLink[];
}
```

**パフォーマンス考慮**:
- 大規模ファイル（100KB以上）でも50ms以内の応答
- 仮想スクロール対応
- 差分更新による効率的なレンダリング

---

### 2. Vault管理 (Vault Manager)

**責務**: ローカルファイルシステムの読み書き、ファイル監視、Obsidian互換性

**実装**: Rust + tokio（非同期）

**主要機能**:
- ノートディレクトリの読み込みと表示（各ノートは独立したディレクトリ）
- ノートディレクトリの作成・削除・リネーム
- ディレクトリ内のindex.mdおよび関連ファイルの管理
- 外部ツールによる変更の自動検出（2秒以内）
- ゴミ箱への移動（永続削除ではなく）
- 複数Vault対応

**ノート構造**:
各ノートは独立したディレクトリとして管理され、以下の構成を持ちます:
- `index.md` - メインのノートコンテンツ
- `*.md` - 関連するMarkdownファイル（オプション）
- `attachments/` - 画像やファイルなどの添付ファイル（オプション）

**ファイル構造**:
```
~/.config/nomos/
  config.toml              # 設定ファイル

~/vault/                   # ユーザーのvault（任意の場所）
  2024-03-16/
    index.md               # ノート（ディレクトリ内のindex.md）
    attachments/           # 添付ファイル
  projects/
    project-a/
      index.md
      notes.md
      attachments/
    project-b/
      index.md
  research/
    paper-notes/
      index.md
  .obsidian/               # Obsidian設定（読み取りのみ）
  .trash/                  # 削除ファイル

~/.local/share/nomos/
  nomos.db                 # SQLiteデータベース
  models/                  # LLMモデルファイル
  index/                   # tantivyインデックス
```

**インターフェース**:
```rust
pub trait VaultManager {
    /// ノートディレクトリのリストを取得
    async fn list_notes(&self, path: &Path) -> Result<Vec<NoteEntry>>;
    
    /// ノートのindex.mdを読み込む
    async fn read_note(&self, note_dir: &Path) -> Result<String>;
    
    /// ノートのindex.mdを保存
    async fn write_note(&self, note_dir: &Path, content: &str) -> Result<()>;
    
    /// ノートディレクトリを削除（ゴミ箱に移動）
    async fn delete_note(&self, note_dir: &Path) -> Result<()>;
    
    /// ノートディレクトリをリネーム
    async fn rename_note(&self, old_dir: &Path, new_dir: &Path) -> Result<()>;
    
    /// ノートディレクトリ内のファイル変更を監視
    async fn watch_changes(&self) -> Result<Receiver<FileChangeEvent>>;
}

pub struct NoteEntry {
    pub path: PathBuf,           // ノートディレクトリのパス
    pub name: String,            // ノート名（ディレクトリ名）
    pub has_index_md: bool,      // index.mdが存在するか
    pub modified_at: SystemTime, // 最終更新時刻
    pub file_count: usize,       // ディレクトリ内のファイル数
}

pub enum FileChangeEvent {
    NoteCreated(PathBuf),        // ノートディレクトリが作成された
    NoteModified(PathBuf),       // ノートのindex.mdが変更された
    NoteDeleted(PathBuf),        // ノートディレクトリが削除された
    NoteRenamed { old: PathBuf, new: PathBuf }, // ノートディレクトリがリネームされた
    AttachmentAdded(PathBuf),    // 添付ファイルが追加された
}
```

---

### 3. AI バックエンド (AI Backend)

**責務**: LLM推論とEmbedding生成の統一インターフェース

**実装**: Rust + ModelBackend trait

**ModelBackend トレイト**:
```rust
pub trait ModelBackend: Send + Sync {
    /// テキストから応答を生成
    async fn generate(&self, prompt: &str) -> Result<String>;
    
    /// テキストをベクトルに変換
    async fn embed(&self, text: &str) -> Result<Vec<f32>>;
    
    /// モデル名を返す
    fn model_name(&self) -> &str;
    
    /// モデルが利用可能か確認
    async fn is_available(&self) -> bool;
}
```

**デフォルト実装: LlamaCppBackend**
```rust
pub struct LlamaCppBackend {
    model: Arc<LlamaModel>,
    model_path: PathBuf,
    context_size: usize,
}

impl LlamaCppBackend {
    pub async fn new(model_path: &Path) -> Result<Self> {
        // llama-cpp-2クレート経由でモデルをロード
        // Gemma 3 1B GGUF (q4_0) を使用
    }
}
```

**拡張実装: OllamaBackend**
```rust
pub struct OllamaBackend {
    base_url: String,  // デフォルト: http://localhost:11434
    model: String,
    client: reqwest::Client,
}
```

**設定例** (config.toml):
```toml
[ai]
backend = "llamacpp"  # または "ollama"
model_path = "~/.local/share/nomos/models/gemma-3-1b-it-q4_0.gguf"
embedding_model = "nomic-embed-text"

[ai.ollama]
base_url = "http://localhost:11434"
model = "mistral"  # 大型モデル用
```

---

### 4. Embedding エンジン (Embedding Engine)

**責務**: ノートのベクトル化と類似度計算

**実装**: Rust + nomic-embed-text

**主要機能**:
- ノート保存時の自動ベクトル化
- SQLiteへの保存
- コサイン類似度計算
- キャッシング

**インターフェース**:
```rust
pub struct EmbeddingEngine {
    backend: Arc<dyn ModelBackend>,
    db: Arc<Database>,
}

impl EmbeddingEngine {
    pub async fn embed_note(&self, file_path: &Path, content: &str) -> Result<()> {
        let embedding = self.backend.embed(content).await?;
        self.db.store_embedding(file_path, &embedding).await?;
        Ok(())
    }
    
    pub async fn find_similar(&self, file_path: &Path, top_k: usize) -> Result<Vec<SimilarNote>> {
        let embedding = self.db.get_embedding(file_path).await?;
        let similar = self.db.find_similar_embeddings(&embedding, top_k).await?;
        Ok(similar)
    }
}

pub struct SimilarNote {
    pub file_path: PathBuf,
    pub similarity: f32,  // 0.0 - 1.0
    pub preview: String,
}
```

**パフォーマンス**:
- ノートあたり5秒以内（q4_0量子化モデル）
- バックグラウンドで非同期実行
- キャッシュにより重複計算を回避

---

### 5. Judgement Brain (マージン注釈システム)

**責務**: 関連ノート、矛盾検出、論文リンク、サマリの表示

**実装**: React (Frontend) + Rust (Backend)

**マージン注釈の種類**:

| アイコン | 種類 | トリガー | 更新頻度 |
|---|---|---|---|
| 💡 | 関連過去ノート | embedding類似度 > 0.75 | リアルタイム（debounce 500ms） |
| ⚡ | 矛盾・一致 | Gemma推論 | バックグラウンド（ユーザーアイドル2秒後） |
| 📄 | 論文・文献 | BibTeX + embedding | 保存時 |
| 📊 | 強み・弱みサマリ | 週次バッチ | 毎週月曜朝 |

**UI レイアウト**:
```
┌──────────────────────────────────────────┬──────────────────┐
│ 今日の思考...                            │ ┊ 💡 2024/09に    │
│                                          │ ┊ 同じ問いあり    │
│ 自分の強みは抽象化能力にあると思う。     │ ┊                 │
│                                          │ ┊ ⚡ 矛盾:        │
│ 具体的には、複雑な問題を単純化できる。   │ ┊ 12/03「具体性   │
│                                          │ ┊ が強み」と記録  │
│                                          │ ┊                 │
│                                          │ ┊ 📄 関連論文:    │
│                                          │ ┊ Sweller 1988   │
│                                          │ ┊ Cognitive Load │
└──────────────────────────────────────────┴──────────────────┘
```

**インターフェース**:
```rust
pub struct JudgementBrain {
    embedding_engine: Arc<EmbeddingEngine>,
    backend: Arc<dyn ModelBackend>,
    db: Arc<Database>,
    bibtex_parser: Arc<BibTexParser>,
}

pub struct MarginAnnotation {
    pub annotation_type: AnnotationType,
    pub icon: String,
    pub title: String,
    pub content: String,
    pub link: Option<String>,
}

pub enum AnnotationType {
    RelatedNote { file_path: PathBuf, similarity: f32 },
    Contradiction { conflicting_note: PathBuf, reason: String },
    PaperLink { bibtex_key: String, title: String },
    WeeklySummary { week: String, url: String },
}

impl JudgementBrain {
    pub async fn get_annotations(&self, file_path: &Path) -> Result<Vec<MarginAnnotation>> {
        // 複数の情報源から注釈を集約
    }
}
```

---

### 6. データベース層 (Database Layer)

**責務**: 行動ログ、embedding、メタデータの永続化

**実装**: SQLite + rusqlite

**スキーマ**:
```sql
-- 行動ログテーブル
CREATE TABLE activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL,
    action TEXT NOT NULL,  -- 'open' | 'edit' | 'close'
    timestamp INTEGER NOT NULL,
    duration_sec INTEGER,
    INDEX idx_file_path (file_path),
    INDEX idx_timestamp (timestamp)
);

-- ノートのembeddingテーブル
CREATE TABLE note_embeddings (
    file_path TEXT PRIMARY KEY,
    embedding BLOB NOT NULL,  -- Vec<f32>をbincode形式でシリアライズ
    updated_at INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    INDEX idx_updated_at (updated_at)
);

-- 週次サマリテーブル
CREATE TABLE weekly_summaries (
    week TEXT PRIMARY KEY,  -- 'YYYY-WNN' 形式
    content TEXT NOT NULL,
    generated_at INTEGER NOT NULL,
    INDEX idx_generated_at (generated_at)
);

-- wikiリンク解決テーブル
CREATE TABLE wikilinks (
    source_file TEXT NOT NULL,
    target_file TEXT NOT NULL,
    link_text TEXT NOT NULL,
    is_broken BOOLEAN DEFAULT 0,
    PRIMARY KEY (source_file, target_file),
    INDEX idx_target_file (target_file)
);

-- 矛盾検出キャッシュ
CREATE TABLE contradiction_cache (
    file_path TEXT PRIMARY KEY,
    contradictions TEXT NOT NULL,  -- JSON形式
    cached_at INTEGER NOT NULL,
    INDEX idx_cached_at (cached_at)
);
```

**インターフェース**:
```rust
pub struct Database {
    pool: Arc<ConnectionPool>,
}

impl Database {
    pub async fn log_activity(&self, file_path: &Path, action: &str, duration_sec: Option<u32>) -> Result<()>;
    pub async fn store_embedding(&self, file_path: &Path, embedding: &[f32]) -> Result<()>;
    pub async fn get_embedding(&self, file_path: &Path) -> Result<Option<Vec<f32>>>;
    pub async fn find_similar_embeddings(&self, embedding: &[f32], top_k: usize) -> Result<Vec<(PathBuf, f32)>>;
    pub async fn store_summary(&self, week: &str, content: &str) -> Result<()>;
    pub async fn get_activity_stats(&self, start_date: Date, end_date: Date) -> Result<ActivityStats>;
}
```

---

### 7. Git マネージャー (Git Manager)

**責務**: 自動commit、diff表示、履歴管理

**実装**: Rust + gitoxide

**主要機能**:
- ファイル保存時の自動commit
- diff表示
- 履歴ブラウズ
- コンフリクト検出

**インターフェース**:
```rust
pub struct GitManager {
    repo_path: PathBuf,
}

impl GitManager {
    pub async fn auto_commit(&self, file_path: &Path, message: &str) -> Result<String>;
    pub async fn get_diff(&self, file_path: &Path) -> Result<String>;
    pub async fn get_history(&self, file_path: &Path, limit: usize) -> Result<Vec<Commit>>;
    pub async fn detect_conflict(&self, file_path: &Path) -> Result<bool>;
}

pub struct Commit {
    pub hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: SystemTime,
}
```

**設定** (config.toml):
```toml
[git]
enabled = true
auto_commit = true
commit_message_template = "[{timestamp}] {file_path}"
```

---

### 8. ファイル監視 (File Watcher)

**責務**: 外部ツールによるファイル変更の検出

**実装**: Rust + notify クレート

**主要機能**:
- 2秒以内の変更検出
- 外部編集時のリロード
- コンフリクト検出と解決

**インターフェース**:
```rust
pub struct FileWatcher {
    vault_path: PathBuf,
    tx: Sender<FileChangeEvent>,
}

impl FileWatcher {
    pub async fn start(&self) -> Result<Receiver<FileChangeEvent>>;
    pub async fn handle_conflict(&self, file_path: &Path) -> Result<ConflictResolution>;
}

pub enum ConflictResolution {
    KeepLocal,
    ReloadExternal,
    Merge,
}
```

---

### 9. 設定管理 (Configuration Manager)

**責務**: config.tomlの読み込みと管理

**実装**: Rust + toml クレート

**設定ファイル位置**: `~/.config/nomos/config.toml`

**設定スキーマ**:
```toml
[vault]
path = "~/Documents/my-vault"
auto_save_interval_ms = 1000

[ai]
backend = "llamacpp"  # "llamacpp" | "ollama"
model_path = "~/.local/share/nomos/models/gemma-3-1b-it-q4_0.gguf"
embedding_model = "nomic-embed-text"
context_size = 2048

[ai.ollama]
base_url = "http://localhost:11434"
model = "mistral"

[git]
enabled = true
auto_commit = true
commit_message_template = "[{timestamp}] {file_path}"

[judgement_brain]
enabled = true
similarity_threshold = 0.75
contradiction_check_idle_ms = 2000
update_debounce_ms = 500

[performance]
max_memory_mb = 2048
embedding_batch_size = 10
```

**インターフェース**:
```rust
pub struct Config {
    pub vault: VaultConfig,
    pub ai: AiConfig,
    pub git: GitConfig,
    pub judgement_brain: JudgementBrainConfig,
    pub performance: PerformanceConfig,
}

impl Config {
    pub fn load() -> Result<Self>;
    pub fn save(&self) -> Result<()>;
    pub fn reload(&mut self) -> Result<()>;
}
```



---

## データモデル

### ノート (Note)

```rust
pub struct Note {
    pub note_dir: PathBuf,        // ノートディレクトリのパス
    pub index_md_path: PathBuf,   // index.mdのフルパス
    pub content: String,          // index.mdの内容
    pub frontmatter: Option<Frontmatter>,
    pub wikilinks: Vec<WikiLink>,
    pub tags: Vec<String>,
    pub attachments: Vec<PathBuf>, // attachments/ディレクトリ内のファイル
    pub related_files: Vec<PathBuf>, // ディレクトリ内の他のMarkdownファイル
    pub created_at: SystemTime,
    pub modified_at: SystemTime,
}

pub struct Frontmatter {
    pub title: Option<String>,
    pub tags: Vec<String>,
    pub aliases: Vec<String>,
    pub custom_fields: HashMap<String, String>,
}

pub struct WikiLink {
    pub text: String,
    pub target: String,           // ターゲットノートのディレクトリ名
    pub is_broken: bool,
    pub position: (usize, usize),  // (line, column)
}
```

### 行動ログ (Activity Log)

```rust
pub struct ActivityLog {
    pub id: u64,
    pub file_path: PathBuf,
    pub action: ActivityAction,
    pub timestamp: SystemTime,
    pub duration_sec: Option<u32>,
}

pub enum ActivityAction {
    Open,
    Edit,
    Close,
}

pub struct ActivityStats {
    pub total_files_edited: usize,
    pub total_time_spent_sec: u32,
    pub most_edited_files: Vec<(PathBuf, u32)>,
    pub editing_patterns: Vec<EditingPattern>,
}

pub struct EditingPattern {
    pub hour_of_day: u8,
    pub frequency: usize,
    pub avg_duration_sec: u32,
}
```

### Embedding (ベクトル表現)

```rust
pub struct NoteEmbedding {
    pub note_dir: PathBuf,        // ノートディレクトリのパス
    pub embedding: Vec<f32>,      // 384次元（nomic-embed-text）
    pub updated_at: SystemTime,
    pub content_hash: String,
}

pub struct SimilarityResult {
    pub note_dir: PathBuf,        // ノートディレクトリのパス
    pub similarity: f32,          // コサイン類似度 0.0-1.0
    pub preview: String,
}
```

### 矛盾検出 (Contradiction Detection)

```rust
pub struct Contradiction {
    pub id: String,
    pub current_note: PathBuf,
    pub conflicting_note: PathBuf,
    pub reason: String,
    pub confidence: f32,  // 0.0-1.0
    pub detected_at: SystemTime,
}

pub struct ContradictionCache {
    pub file_path: PathBuf,
    pub contradictions: Vec<Contradiction>,
    pub cached_at: SystemTime,
    pub ttl_sec: u32,  // キャッシュの有効期限
}
```

### 週次サマリ (Weekly Summary)

```rust
pub struct WeeklySummary {
    pub week: String,  // "2024-W12"
    pub strengths: Vec<String>,
    pub weaknesses: Vec<String>,
    pub insights: Vec<String>,
    pub activity_summary: ActivityStats,
    pub generated_at: SystemTime,
}
```

### BibTeX エントリ (Bibliography Entry)

```rust
pub struct BibTexEntry {
    pub key: String,
    pub entry_type: String,  // "article", "book", etc.
    pub fields: HashMap<String, String>,
}

pub struct PaperLink {
    pub bibtex_key: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<u32>,
    pub similarity: f32,
}
```

### マージン注釈 (Margin Annotation)

```rust
pub struct MarginAnnotation {
    pub id: String,
    pub annotation_type: AnnotationType,
    pub icon: String,
    pub title: String,
    pub content: String,
    pub link: Option<String>,
    pub priority: u8,  // 表示順序
}

pub enum AnnotationType {
    RelatedNote {
        file_path: PathBuf,
        similarity: f32,
    },
    Contradiction {
        conflicting_note: PathBuf,
        reason: String,
        confidence: f32,
    },
    PaperLink {
        bibtex_key: String,
        title: String,
    },
    WeeklySummary {
        week: String,
    },
}
```

---

## API/インターフェース設計

### Tauri IPC コマンド

フロントエンドとバックエンド間の通信は、Tauri IPC経由で行われます。

**エディタ関連**:
```typescript
// ファイルを開く
invoke('open_file', { path: string }): Promise<{ content: string; frontmatter?: object }>

// ファイルを保存
invoke('save_file', { path: string; content: string }): Promise<{ success: boolean }>

// wikiリンクを解決
invoke('resolve_wikilink', { link: string }): Promise<{ path: string; exists: boolean }>

// バックリンクを取得
invoke('get_backlinks', { path: string }): Promise<{ links: Array<{ source: string; text: string }> }>
```

**Vault関連**:
```typescript
// ファイルツリーを取得
invoke('list_files', { path?: string }): Promise<{ files: FileEntry[] }>

// ファイルを作成
invoke('create_file', { path: string; content?: string }): Promise<{ success: boolean }>

// ファイルを削除
invoke('delete_file', { path: string }): Promise<{ success: boolean }>

// ファイルをリネーム
invoke('rename_file', { oldPath: string; newPath: string }): Promise<{ success: boolean }>
```

**Judgement Brain関連**:
```typescript
// マージン注釈を取得
invoke('get_margin_annotations', { path: string }): Promise<{ annotations: MarginAnnotation[] }>

// 関連ノートを取得
invoke('get_related_notes', { path: string; limit?: number }): Promise<{ notes: SimilarNote[] }>

// 矛盾を検出
invoke('detect_contradictions', { path: string }): Promise<{ contradictions: Contradiction[] }>

// 週次サマリを取得
invoke('get_weekly_summary', { week?: string }): Promise<{ summary: WeeklySummary }>
```

**設定関連**:
```typescript
// 設定を取得
invoke('get_config'): Promise<{ config: Config }>

// 設定を更新
invoke('update_config', { config: Partial<Config> }): Promise<{ success: boolean }>

// 設定をリロード
invoke('reload_config'): Promise<{ success: boolean }>
```

**Git関連**:
```typescript
// diffを取得
invoke('get_diff', { path: string }): Promise<{ diff: string }>

// 履歴を取得
invoke('get_history', { path: string; limit?: number }): Promise<{ commits: Commit[] }>

// 自動commitを有効化
invoke('enable_auto_commit'): Promise<{ success: boolean }>
```

---

## AI推論アーキテクチャ

### 3層構造

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Embedding（常時実行）                              │
│ ├─ nomic-embed-text（軽量、384次元）                        │
│ ├─ ノート保存時に自動実行                                   │
│ ├─ マージン注釈のリアルタイム類似検索に使用                 │
│ └─ 応答時間: 5秒/ノート                                     │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: 1B推論（オンデマンド・バックグラウンド）           │
│ ├─ Gemma 3 1B GGUF (q4_0, 600MB)                         │
│ ├─ CPU動作（GPU不要）                                       │
│ ├─ 矛盾検出・論文紐付け・質問応答に使用                     │
│ ├─ ユーザーアイドル2秒後に実行                              │
│ └─ 応答時間: 30秒/推論                                      │
└─────────────────────────────────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: 拡張推論（ユーザー設定）                           │
│ ├─ ModelBackend traitで任意モデルに切り替え                │
│ ├─ Ollama経由で大型モデル（Mistral等）を使用               │
│ ├─ 深いサマリ・分析に使用                                   │
│ └─ 応答時間: 可変（モデル依存）                             │
└─────────────────────────────────────────────────────────────┘
```

### バックグラウンドスケジューラ

```rust
pub struct BackgroundScheduler {
    embedding_queue: Arc<Mutex<VecDeque<PathBuf>>>,
    contradiction_queue: Arc<Mutex<VecDeque<PathBuf>>>,
    summary_schedule: Arc<Mutex<WeeklySummarySchedule>>,
}

impl BackgroundScheduler {
    pub async fn run(&self) {
        loop {
            // Embedding処理（優先度高）
            if let Some(file_path) = self.embedding_queue.lock().await.pop_front() {
                self.process_embedding(&file_path).await;
            }
            
            // 矛盾検出（優先度中、ユーザーアイドル時のみ）
            if self.is_user_idle().await {
                if let Some(file_path) = self.contradiction_queue.lock().await.pop_front() {
                    self.detect_contradictions(&file_path).await;
                }
            }
            
            // 週次サマリ（優先度低、スケジュール実行）
            if self.should_generate_summary().await {
                self.generate_weekly_summary().await;
            }
            
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}
```

### Gemma 3 1B 統合

**モデルダウンロード**:
- HuggingFace: `bartowski/gemma-3-1b-it-GGUF`
- ファイル: `gemma-3-1b-it-q4_0.gguf` (600MB)
- 初回起動時に自動ダウンロード

**推論パラメータ**:
```rust
pub struct InferenceParams {
    pub max_tokens: usize,        // 512
    pub temperature: f32,          // 0.7
    pub top_p: f32,               // 0.9
    pub top_k: usize,             // 40
    pub repeat_penalty: f32,      // 1.1
}
```

**プロンプトテンプレート**:

矛盾検出:
```
現在のノート:
{current_note_content}

過去のノート:
{past_note_content}

これらのノートに矛盾がありますか？あれば、その理由を簡潔に説明してください。
```

論文紐付け:
```
このノートの内容:
{note_content}

この論文は関連していますか？
タイトル: {paper_title}
著者: {paper_authors}
年: {paper_year}

関連性を0-100で評価してください。
```

---

## パフォーマンス考慮事項

### 非同期処理戦略

すべてのI/O操作は非同期で実行され、エディタの応答性を損なわない:

```rust
// ファイル読み書き
tokio::fs::read_to_string(path).await

// データベースアクセス
db.query_async(sql).await

// AI推論
backend.generate_async(prompt).await

// ファイル監視
watcher.watch_async(path).await
```

### キャッシング機構

```rust
pub struct Cache<K, V> {
    data: Arc<RwLock<HashMap<K, CacheEntry<V>>>>,
    ttl: Duration,
}

pub struct CacheEntry<V> {
    value: V,
    created_at: Instant,
}

impl<K, V> Cache<K, V> {
    pub async fn get_or_compute<F>(&self, key: K, compute: F) -> Result<V>
    where
        F: Fn() -> BoxFuture<'static, Result<V>>,
    {
        // キャッシュヒット時は即座に返す
        // ミス時は計算して保存
    }
}
```

**キャッシュ対象**:
- Embedding（ファイルハッシュが変わるまで有効）
- 矛盾検出結果（1時間有効）
- 関連ノート検索結果（30分有効）
- BibTeX解析結果（ファイル変更まで有効）

### データベースインデックス

```sql
-- 高速検索のためのインデックス
CREATE INDEX idx_activity_file_path ON activity_log(file_path);
CREATE INDEX idx_activity_timestamp ON activity_log(timestamp);
CREATE INDEX idx_wikilinks_target ON wikilinks(target_file);
CREATE INDEX idx_embeddings_updated ON note_embeddings(updated_at);
```

### メモリ管理

- 最大メモリ使用量: 2GB
- Gemmaモデル: 600MB（q4_0量子化）
- Embedding キャッシュ: 最大1000ノート × 384次元 × 4bytes = 1.5MB
- 行動ログ: 最大100,000エントリ × 100bytes = 10MB

---

## セキュリティとプライバシー

### データ保存戦略

すべてのデータはローカルに保存され、外部サーバーに送信されません:

```
~/.config/nomos/config.toml          # 設定（平文）
~/.local/share/nomos/nomos.db        # SQLiteデータベース
~/.local/share/nomos/models/         # LLMモデルファイル
~/vault/                             # ユーザーのMarkdownファイル
```

### ファイルパーミッション

```rust
pub fn set_secure_permissions(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        std::fs::set_permissions(path, perms)?;
    }
    Ok(())
}
```

### 削除ファイルの処理

ファイル削除時は永続削除ではなく、ゴミ箱に移動:

```rust
pub async fn delete_file(&self, path: &Path) -> Result<()> {
    let trash_path = self.vault_path.join(".trash").join(path.file_name().unwrap());
    tokio::fs::rename(path, trash_path).await?;
    Ok(())
}
```

### 外部通信の禁止

- ネットワークライブラリは`reqwest`のみ（Ollama接続用）
- デフォルトではローカルホストのみ接続可能
- 設定で明示的に有効化しない限り、外部通信なし

---

## クロスプラットフォーム対応

### ファイルパス処理

```rust
pub fn normalize_path(path: &str) -> PathBuf {
    let expanded = shellexpand::tilde(path);
    PathBuf::from(expanded.as_ref())
}

// 使用例
let vault_path = normalize_path("~/Documents/my-vault");
// Windows: C:\Users\username\Documents\my-vault
// macOS/Linux: /home/username/Documents/my-vault
```

### OS固有の処理

```rust
#[cfg(target_os = "windows")]
fn get_config_dir() -> PathBuf {
    PathBuf::from(std::env::var("APPDATA").unwrap()).join("nomos")
}

#[cfg(target_os = "macos")]
fn get_config_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap()).join("Library/Application Support/nomos")
}

#[cfg(target_os = "linux")]
fn get_config_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap()).join(".config/nomos")
}
```

### Tauri v2 統合

```rust
// main.rs
#[tauri::command]
async fn get_platform() -> String {
    std::env::consts::OS.to_string()
}

// Tauri設定
{
    "build": {
        "beforeBuildCommand": "npm run build",
        "devPath": "http://localhost:5173",
        "frontendDist": "../dist"
    },
    "app": {
        "windows": [
            {
                "title": "Nomos",
                "width": 1200,
                "height": 800,
                "resizable": true
            }
        ]
    }
}
```



---

## 正確性プロパティ (Correctness Properties)

*プロパティとは、システムの有効な実行全体にわたって真であるべき特性または動作です。本質的には、システムが何をすべきかについての形式的な声明であり、人間が読める仕様と機械検証可能な正確性保証の間の橋渡しとなります。*

### プロパティ1: Markdown解析の正確性

**For any** CommonMark準拠のMarkdownテキスト、エディタで解析してから出力すると、元のテキストと同等の構造を持つAST（抽象構文木）が得られる。

**検証対象: 要件1.1, 1.2, 1.3**

### プロパティ2: wikiリンク解決の一貫性

**For any** ノートセット内のwikiリンク、リンク先が存在する場合は常に解決され、存在しない場合は常に破損マークが付く。

**検証対象: 要件2.1, 2.2, 2.4**

### プロパティ3: wikiリンク更新の完全性

**For any** ノートのリネーム操作、そのノートを参照するすべてのwikiリンクが新しい名前に更新される。

**検証対象: 要件2.5**

### プロパティ4: バックリンク表示の正確性

**For any** ノート、バックリンクパネルに表示されるすべてのリンクは、実際にそのノートを参照している他のノートからのものである。

**検証対象: 要件2.3**

### プロパティ5: ファイルツリー表示の完全性

**For any** vaultディレクトリ、ファイルツリーに表示されるMarkdownファイルのセットは、ディレクトリに存在するMarkdownファイルのセットと完全に一致する。

**検証対象: 要件3.2**

### プロパティ6: 外部ファイル変更の検出

**For any** vaultディレクトリ内のファイル、外部ツールで変更されてから2秒以内に、ファイルツリーが更新される。

**検証対象: 要件3.3, 17.1**

### プロパティ7: ファイル削除の安全性

**For any** ノート削除操作、ファイルはゴミ箱ディレクトリに移動され、元のvaultディレクトリからは削除される。

**検証対象: 要件3.5, 19.4**

### プロパティ8: Obsidian互換性 - ファイル形式

**For any** Obsidian vaultから読み込んだMarkdownファイル、Nomosで編集して保存した後、Obsidianで再度開くと、frontmatterとメタデータが完全に保持される。

**検証対象: 要件4.1, 4.2**

### プロパティ9: Obsidian互換性 - wikiリンク解決

**For any** Obsidian vaultのwikiリンク、Nomosで解決されるターゲットはObsidianの解決ルールと一致する。

**検証対象: 要件4.4**

### プロパティ10: 自動保存の時間制約

**For any** テキスト修正操作、ファイルシステムへの書き込みが1秒以内に完了する。

**検証対象: 要件1.5**

### プロパティ11: Git自動commitの実行

**For any** ファイル保存操作（Git統合が有効な場合）、gitoxideを使用してcommitが作成される。

**検証対象: 要件5.1, 5.6**

### プロパティ12: Undo/Redoの往復特性

**For any** エディタ操作シーケンス、すべての操作をundoしてからredoすると、元の状態に戻る。

**検証対象: 要件1.4**

### プロパティ13: 行動ログの記録完全性

**For any** ファイル操作（開く、編集、閉じる）、対応する行動ログエントリがSQLiteデータベースに記録される。

**検証対象: 要件7.1, 7.2, 7.3, 7.4**

### プロパティ14: Embedding生成の非ブロッキング性

**For any** ノート保存操作、embeddingの生成がバックグラウンドで非同期に実行され、エディタの応答時間に影響しない。

**検証対象: 要件8.5**

### プロパティ15: Embedding保存の正確性

**For any** ノート、embeddingが生成されてSQLiteに保存された場合、ファイルパスをキーとして取得できる。

**検証対象: 要件8.3, 8.4**

### プロパティ16: Embedding削除の一貫性

**For any** ノート削除操作、対応するembeddingがデータベースから削除される。

**検証対象: 要件8.6**

### プロパティ17: マージン注釈の類似度フィルタリング

**For any** 編集中のノート、マージン注釈パネルに表示される関連ノートのコサイン類似度はすべて0.75以上である。

**検証対象: 要件9.3**

### プロパティ18: マージン注釈の非ブロッキング性

**For any** マージン注釈パネルが表示されている状態、エディタの応答時間は50ms以下である。

**検証対象: 要件9.4**

### プロパティ19: マージン注釈のリアルタイム更新

**For any** ユーザーがノートを編集している場合、マージン注釈パネルは500msのdebounce後に更新される。

**検証対象: 要件9.6**

### プロパティ20: 矛盾検出のアイドル依存性

**For any** ノート編集セッション、矛盾検出はユーザーが2秒以上アイドル状態の場合のみ実行される。

**検証対象: 要件10.5**

### プロパティ21: 矛盾検出の非ブロッキング性

**For any** 矛盾検出が実行中の場合、エディタの応答時間は50ms以下である。

**検証対象: 要件10.3**

### プロパティ22: BibTeX解析の完全性

**For any** vaultに存在するBibTeXファイル、すべてのエントリが正しく解析される。

**検証対象: 要件11.1**

### プロパティ23: 論文リンクの類似度ベース

**For any** ノート保存操作、マージン注釈に表示される論文リンクはすべてembedding類似度に基づいている。

**検証対象: 要件11.2, 11.3**

### プロパティ24: 週次サマリの生成トリガー

**For any** 週の終了時点、サマリ生成がバックグラウンドバッチジョブとして実行される。

**検証対象: 要件12.1, 12.3**

### プロパティ25: 週次サマリの永続化

**For any** 生成された週次サマリ、SQLiteデータベースに保存され、後で取得可能である。

**検証対象: 要件12.4**

### プロパティ26: ModelBackendの拡張性

**For any** ModelBackendトレイトの実装、generate()とembed()メソッドを提供し、新しいバックエンドの追加が可能である。

**検証対象: 要件13.1, 13.6**

### プロパティ27: バックエンド設定の切り替え

**For any** config.tomlで指定されたバックエンド、アプリケーション起動時に正しくロードされる。

**検証対象: 要件13.3**

### プロパティ28: バックエンドフォールバック

**For any** 指定されたバックエンドが利用不可の場合、デフォルトバックエンド（llama.cpp）にフォールバックされる。

**検証対象: 要件13.5**

### プロパティ29: Gemmaモデルのダウンロード

**For any** 初回起動時、Gemma 3 1B GGUF (q4_0)モデルが自動的にダウンロードされ、キャッシュされる。

**検証対象: 要件14.1, 14.2**

### プロパティ30: 推論結果のキャッシング

**For any** 推論リクエスト、同一のプロンプトに対する結果は1時間以内にキャッシュから返される。

**検証対象: 要件14.5**

### プロパティ31: 設定ファイルの読み込み

**For any** アプリケーション起動時、~/.config/nomos/config.tomlから設定が読み込まれる。

**検証対象: 要件15.1**

### プロパティ32: 設定のホットリロード

**For any** config.tomlの変更、アプリケーション再起動なしに設定が反映される。

**検証対象: 要件15.3**

### プロパティ33: 設定デフォルト値

**For any** 必須設定フィールドが欠落している場合、合理的なデフォルト値が使用される。

**検証対象: 要件15.5**

### プロパティ34: データベーススキーマの完全性

**For any** 行動ログエントリ、file_path、action、timestamp、duration_secのすべてのフィールドが保存される。

**検証対象: 要件16.1**

### プロパティ35: データベース接続プーリング

**For any** データベースアクセス、接続プーリングが使用されてパフォーマンスが最適化される。

**検証対象: 要件16.4**

### プロパティ36: ファイルパーミッション管理

**For any** SQLiteデータベースファイル、ファイルパーミッションが0600（所有者のみ読み取り可能）に設定される。

**検証対象: 要件19.3**

### プロパティ37: ローカルデータ保存

**For any** ユーザーデータ、~/.local/share/nomos/またはvaultディレクトリ内にのみ保存され、外部サーバーに送信されない。

**検証対象: 要件19.1, 19.2**

### プロパティ38: ファイルパス正規化

**For any** ファイルパス操作、パスが現在のOSに対して正規化される（パスセパレータ、大文字小文字など）。

**検証対象: 要件20.4, 20.5**

### プロパティ39: クロスプラットフォーム互換性

**For any** アプリケーション機能、Windows、macOS、Linuxで同等に動作する。

**検証対象: 要件20.1, 20.2**

### プロパティ40: パフォーマンス - ファイルツリー表示

**For any** 10,000ノートのvault、ファイルツリーが2秒以内に表示される。

**検証対象: 要件18.1**

### プロパティ41: パフォーマンス - ノート開く

**For any** ノート、エディタに表示されるまで500ms以内である。

**検証対象: 要件18.2**

### プロパティ42: パフォーマンス - キーストローク応答

**For any** キーストローク入力、エディタの応答時間は50ms以下である。

**検証対象: 要件18.3**

### プロパティ43: パフォーマンス - Embedding生成

**For any** ノート、embedding生成が5秒以内に完了する。

**検証対象: 要件18.4**

### プロパティ44: パフォーマンス - Gemma推論

**For any** 推論リクエスト、30秒以内に完了する。

**検証対象: 要件18.5**

### プロパティ45: パフォーマンス - メモリ使用量

**For any** 通常の操作中、アプリケーションのメモリ使用量は2GB以下である。

**検証対象: 要件18.6**

### プロパティ46: LSP統合の可用性

**For any** LSPサーバーが利用不可の場合、エディタは引き続き正常に機能する。

**検証対象: 要件6.6**

### プロパティ47: コンフリクト検出

**For any** ファイルが外部ツールで編集されている間にNomos内で編集された場合、コンフリクトが検出される。

**検証対象: 要件4.6, 17.3**

### プロパティ48: Gemma推論の利用不可時の動作

**For any** Gemma推論が利用不可の場合、矛盾検出は実行されず、エラーメッセージが表示される。

**検証対象: 要件10.6, 14.6**

### プロパティ49: データベース接続のクローズ

**For any** アプリケーション終了時、すべてのデータベース接続が適切にクローズされる。

**検証対象: 要件19.6**

### プロパティ50: 複数Vault対応

**For any** config.tomlで指定された複数のvaultプロファイル、それぞれが独立して切り替え可能である。

**検証対象: 要件3.6, 3.7, 15.4**



---

## エラーハンドリング

### エラー分類

**リカバリ可能なエラー**:
- ファイル読み込み失敗 → ユーザーに通知、リトライ可能
- ネットワーク接続失敗（Ollama） → フォールバック、ローカルモデル使用
- LSPサーバー接続失敗 → LSP機能を無効化、エディタは継続動作
- データベース接続失敗 → 接続プール再初期化、リトライ

**リカバリ不可能なエラー**:
- Gemmaモデルロード失敗 → AI機能を無効化、ユーザーに通知
- vaultパス無効 → 設定エラーダイアログ表示
- SQLiteデータベース破損 → 自動復旧試行、失敗時は再初期化

### エラーハンドリング戦略

```rust
pub enum NomosError {
    // ファイルシステム関連
    FileNotFound(PathBuf),
    FileReadError(PathBuf, String),
    FileWriteError(PathBuf, String),
    
    // データベース関連
    DatabaseError(String),
    DatabaseCorrupted,
    
    // AI推論関連
    ModelLoadError(String),
    InferenceError(String),
    EmbeddingError(String),
    
    // 設定関連
    ConfigError(String),
    InvalidVaultPath(PathBuf),
    
    // Git関連
    GitError(String),
    
    // LSP関連
    LspConnectionError(String),
}

impl NomosError {
    pub fn is_recoverable(&self) -> bool {
        match self {
            NomosError::FileNotFound(_) => true,
            NomosError::LspConnectionError(_) => true,
            NomosError::InferenceError(_) => true,
            NomosError::DatabaseError(_) => true,
            _ => false,
        }
    }
    
    pub fn user_message(&self) -> String {
        match self {
            NomosError::FileNotFound(path) => 
                format!("ファイルが見つかりません: {:?}", path),
            NomosError::ModelLoadError(msg) => 
                format!("モデルのロードに失敗しました: {}", msg),
            NomosError::InvalidVaultPath(path) => 
                format!("無効なvaultパス: {:?}", path),
            _ => "エラーが発生しました".to_string(),
        }
    }
}
```

### グレースフルデグラデーション

```rust
pub struct FeatureAvailability {
    pub editor: bool,           // 常に有効
    pub vault_management: bool, // 常に有効
    pub git_integration: bool,  // Gitが利用可能な場合
    pub lsp_support: bool,      // LSPサーバーが利用可能な場合
    pub ai_features: bool,      // Gemmaが利用可能な場合
    pub embedding: bool,        // embeddingモデルが利用可能な場合
}

impl FeatureAvailability {
    pub async fn detect() -> Self {
        Self {
            editor: true,
            vault_management: true,
            git_integration: git_available().await,
            lsp_support: lsp_available().await,
            ai_features: gemma_available().await,
            embedding: embedding_available().await,
        }
    }
}
```

---

## テスト戦略

### デュアルテスティングアプローチ

Nomosの正確性を確保するため、ユニットテストとプロパティベーステスト（PBT）の両方を使用します。

**ユニットテスト**: 具体的な例、エッジケース、エラー条件を検証
**プロパティテスト**: 普遍的なプロパティをすべての入力に対して検証

### プロパティベーステスト設定

**テスティングフレームワーク**: 
- Rust: `proptest` クレート
- TypeScript: `fast-check` ライブラリ

**テスト実行設定**:
- 最小イテレーション数: 100回
- タイムアウト: 60秒/テスト
- シード固定: 再現可能性確保

### テストカバレッジ計画

#### Phase 1: エディタ基本機能

**ユニットテスト**:
- Markdown解析（CommonMark仕様の各要素）
- wikiリンク検出と解決
- undo/redo操作
- ファイルI/O

**プロパティテスト**:
```rust
// Property 1: Markdown解析の往復特性
#[test]
fn prop_markdown_roundtrip(markdown: String) {
    // Feature: nomos-editor, Property 1: Markdown解析の正確性
    let ast = parse_markdown(&markdown);
    let output = format_ast(&ast);
    let ast2 = parse_markdown(&output);
    assert_eq!(ast, ast2);
}

// Property 2: wikiリンク解決の一貫性
#[test]
fn prop_wikilink_consistency(notes: Vec<Note>, link: WikiLink) {
    // Feature: nomos-editor, Property 2: wikiリンク解決の一貫性
    let exists = notes.iter().any(|n| n.file_path == link.target);
    let resolved = resolve_wikilink(&link, &notes);
    assert_eq!(resolved.is_some(), exists);
}

// Property 10: Undo/Redoの往復特性
#[test]
fn prop_undo_redo_roundtrip(operations: Vec<EditorOperation>) {
    // Feature: nomos-editor, Property 12: Undo/Redoの往復特性
    let mut editor = Editor::new();
    for op in &operations {
        editor.apply(op);
    }
    let state_after = editor.get_state();
    
    for _ in 0..operations.len() {
        editor.undo();
    }
    let state_undone = editor.get_state();
    
    for _ in 0..operations.len() {
        editor.redo();
    }
    let state_redone = editor.get_state();
    
    assert_eq!(state_after, state_redone);
}
```

#### Phase 2: 検索と記憶

**ユニットテスト**:
- Embedding生成
- 類似度計算
- SQLiteへの保存と取得

**プロパティテスト**:
```rust
// Property 15: Embedding保存の正確性
#[test]
fn prop_embedding_storage_retrieval(notes: Vec<Note>) {
    // Feature: nomos-editor, Property 15: Embedding保存の正確性
    let db = Database::new_in_memory();
    for note in &notes {
        let embedding = generate_embedding(&note.content);
        db.store_embedding(&note.file_path, &embedding).unwrap();
    }
    
    for note in &notes {
        let retrieved = db.get_embedding(&note.file_path).unwrap();
        assert!(retrieved.is_some());
    }
}

// Property 17: マージン注釈の類似度フィルタリング
#[test]
fn prop_margin_annotation_similarity_threshold(notes: Vec<Note>) {
    // Feature: nomos-editor, Property 17: マージン注釈の類似度フィルタリング
    let threshold = 0.75;
    let annotations = get_margin_annotations(&notes[0]);
    
    for annotation in annotations {
        if let AnnotationType::RelatedNote { similarity, .. } = annotation.annotation_type {
            assert!(similarity >= threshold);
        }
    }
}
```

#### Phase 3: Judgement Brain

**ユニットテスト**:
- 矛盾検出ロジック
- BibTeX解析
- 週次サマリ生成

**プロパティテスト**:
```rust
// Property 20: 矛盾検出のアイドル依存性
#[test]
fn prop_contradiction_detection_idle_dependent(notes: Vec<Note>) {
    // Feature: nomos-editor, Property 20: 矛盾検出のアイドル依存性
    let detector = ContradictionDetector::new();
    
    // ユーザーがアクティブな場合
    detector.set_user_active(true);
    detector.detect_contradictions(&notes[0]);
    assert!(!detector.is_running());
    
    // ユーザーがアイドル状態の場合
    detector.set_user_active(false);
    std::thread::sleep(Duration::from_secs(2));
    detector.detect_contradictions(&notes[0]);
    assert!(detector.is_running());
}

// Property 22: BibTeX解析の完全性
#[test]
fn prop_bibtex_parsing_completeness(bibtex_content: String) {
    // Feature: nomos-editor, Property 22: BibTeX解析の完全性
    let entries = parse_bibtex(&bibtex_content);
    let reparsed = parse_bibtex(&format_bibtex(&entries));
    assert_eq!(entries.len(), reparsed.len());
}
```

#### Phase 4: 行動ログ統合・検索強化

**ユニットテスト**:
- 行動ログ記録
- 活動統計計算
- 検索クエリ処理

**プロパティテスト**:
```rust
// Property 13: 行動ログの記録完全性
#[test]
fn prop_activity_log_completeness(operations: Vec<FileOperation>) {
    // Feature: nomos-editor, Property 13: 行動ログの記録完全性
    let db = Database::new_in_memory();
    let logger = ActivityLogger::new(db.clone());
    
    for op in &operations {
        logger.log_operation(op).unwrap();
    }
    
    let logs = db.get_all_logs().unwrap();
    assert_eq!(logs.len(), operations.len());
    
    for (log, op) in logs.iter().zip(operations.iter()) {
        assert_eq!(log.file_path, op.file_path);
        assert_eq!(log.action, op.action);
    }
}
```

### パフォーマンステスト

```rust
#[test]
fn perf_editor_response_time() {
    // Feature: nomos-editor, Property 42: パフォーマンス - キーストローク応答
    let mut editor = Editor::new();
    let start = Instant::now();
    
    for _ in 0..1000 {
        editor.insert_char('a');
    }
    
    let elapsed = start.elapsed();
    assert!(elapsed < Duration::from_millis(50 * 1000)); // 50ms × 1000キー
}

#[test]
fn perf_file_tree_display() {
    // Feature: nomos-editor, Property 40: パフォーマンス - ファイルツリー表示
    let vault = create_test_vault_with_n_files(10000);
    let start = Instant::now();
    
    let tree = vault.build_file_tree();
    
    let elapsed = start.elapsed();
    assert!(elapsed < Duration::from_secs(2));
}

#[test]
fn perf_embedding_generation() {
    // Feature: nomos-editor, Property 43: パフォーマンス - Embedding生成
    let note = create_test_note(5000); // 5000文字
    let start = Instant::now();
    
    let embedding = generate_embedding(&note.content);
    
    let elapsed = start.elapsed();
    assert!(elapsed < Duration::from_secs(5));
}

#[test]
fn perf_memory_usage() {
    // Feature: nomos-editor, Property 45: パフォーマンス - メモリ使用量
    let initial_memory = get_memory_usage();
    
    let vault = create_test_vault_with_n_files(10000);
    let _editor = Editor::new_with_vault(&vault);
    
    let peak_memory = get_memory_usage();
    let used_memory = peak_memory - initial_memory;
    
    assert!(used_memory < 2 * 1024 * 1024 * 1024); // 2GB
}
```

### テスト実行方法

**ユニットテスト**:
```bash
# Rustバックエンド
cargo test --lib

# TypeScriptフロントエンド
npm test
```

**プロパティテスト**:
```bash
# Rustプロパティテスト（100イテレーション）
cargo test --lib -- --nocapture --test-threads=1

# TypeScriptプロパティテスト
npm run test:property
```

**パフォーマンステスト**:
```bash
# リリースビルドで実行（最適化有効）
cargo test --release -- --nocapture --test-threads=1 perf_
```

### テストカバレッジ目標

- 全体: 80%以上
- クリティカルパス（エディタ、ファイルI/O、AI推論）: 90%以上
- UI層: 60%以上（手動テストで補完）



---

## UI/UX設計

### エディタレイアウト

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Nomos - my-vault/2024-03-16.md                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  ┌──────────────────────────────────────────┬──────────────────────┐   │
│  │ File Tree                                │ Margin Annotations   │   │
│  │                                          │                      │   │
│  │ 📁 vault/                               │ ┊ 💡 2024/09に      │   │
│  │  📄 2024-03-16.md (current)             │ ┊ 同じ問いあり      │   │
│  │  📄 2024-03-15.md                       │ ┊                    │   │
│  │  📄 2024-03-14.md                       │ ┊ ⚡ 矛盾:          │   │
│  │  📁 projects/                           │ ┊ 12/03「具体性     │   │
│  │   📄 project-a.md                       │ ┊ が強み」と記録    │   │
│  │   📄 project-b.md                       │ ┊                    │   │
│  │  📁 research/                           │ ┊ 📄 関連論文:      │   │
│  │   📄 paper-notes.md                     │ ┊ Sweller 1988      │   │
│  │                                          │ ┊                    │   │
│  │ Backlinks:                               │ ┊ 📊 週次サマリ    │   │
│  │ • 2024-03-15.md                         │ ┊ 強み: 抽象化能力  │   │
│  │ • project-a.md                          │ ┊ 弱み: 実装スピード│   │
│  │                                          │                      │   │
│  ├──────────────────────────────────────────┤                      │   │
│  │ # 今日の思考                             │                      │   │
│  │                                          │                      │   │
│  │ 自分の強みは抽象化能力にあると思う。     │                      │   │
│  │ 複雑な問題を単純化できる。               │                      │   │
│  │                                          │                      │   │
│  │ [[関連ノート]]を参照。                   │                      │   │
│  │                                          │                      │   │
│  │ 具体的には:                              │                      │   │
│  │ - システム設計                           │                      │   │
│  │ - アーキテクチャ検討                     │                      │   │
│  │                                          │                      │   │
│  │ #思考 #強み                              │                      │   │
│  │                                          │                      │   │
│  └──────────────────────────────────────────┴──────────────────────┘   │
│                                                                           │
│ Line 12, Column 45 | Ln 12, Col 45 | UTF-8 | Markdown                  │
└─────────────────────────────────────────────────────────────────────────┘
```

### マージン注釈の種類と表示

| アイコン | 種類 | 表示内容 | インタラクション |
|---|---|---|---|
| 💡 | 関連ノート | ノート名 + 類似度 | クリックで開く |
| ⚡ | 矛盾 | 矛盾の理由 + 参照ノート | クリックで参照ノート表示 |
| 📄 | 論文 | 論文タイトル + 著者 | クリックでBibTeX表示 |
| 📊 | サマリ | 強み・弱み | クリックで詳細表示 |

### マージン注釈のインタラクション

```typescript
interface MarginAnnotation {
  id: string;
  type: 'related' | 'contradiction' | 'paper' | 'summary';
  icon: string;
  title: string;
  preview: string;
  link?: string;
  priority: number;  // 表示順序
  
  // インタラクション
  onClick?: () => void;
  onHover?: () => void;
}

// 表示ロジック
function renderMarginAnnotations(annotations: MarginAnnotation[]) {
  return annotations
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 5)  // 最大5個表示
    .map(ann => (
      <div 
        key={ann.id}
        className="margin-annotation"
        onClick={ann.onClick}
        onMouseEnter={ann.onHover}
      >
        <span className="icon">{ann.icon}</span>
        <div className="content">
          <div className="title">{ann.title}</div>
          <div className="preview">{ann.preview}</div>
        </div>
      </div>
    ));
}
```

### ファイルツリーのUI

```typescript
interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileTreeNode[];
  isOpen?: boolean;
  isSelected?: boolean;
}

// ファイルツリーのレンダリング
function renderFileTree(nodes: FileTreeNode[], depth = 0) {
  return nodes.map(node => (
    <div key={node.path} style={{ marginLeft: `${depth * 16}px` }}>
      <div 
        className={`file-tree-item ${node.isSelected ? 'selected' : ''}`}
        onClick={() => selectFile(node.path)}
      >
        {node.isDir ? (
          <>
            <span className="icon">{node.isOpen ? '📁' : '📂'}</span>
            <span className="name">{node.name}</span>
          </>
        ) : (
          <>
            <span className="icon">📄</span>
            <span className="name">{node.name}</span>
          </>
        )}
      </div>
      {node.isDir && node.isOpen && node.children && (
        renderFileTree(node.children, depth + 1)
      )}
    </div>
  ));
}
```

### バックリンクパネル

```typescript
interface BacklinkPanel {
  currentFile: string;
  backlinks: Array<{
    sourceFile: string;
    linkText: string;
    context: string;  // リンク周辺のテキスト
  }>;
}

// バックリンクの表示
function renderBacklinks(panel: BacklinkPanel) {
  return (
    <div className="backlinks-panel">
      <h3>Backlinks ({panel.backlinks.length})</h3>
      {panel.backlinks.map((link, idx) => (
        <div 
          key={idx}
          className="backlink-item"
          onClick={() => openFile(link.sourceFile)}
        >
          <div className="source-file">{link.sourceFile}</div>
          <div className="context">{link.context}</div>
        </div>
      ))}
    </div>
  );
}
```

### 設定UI

```typescript
interface ConfigUI {
  sections: {
    vault: VaultConfigSection;
    ai: AiConfigSection;
    git: GitConfigSection;
    judgement_brain: JudgementBrainConfigSection;
    performance: PerformanceConfigSection;
  };
}

// 設定画面のレイアウト
function renderConfigUI() {
  return (
    <div className="config-ui">
      <div className="config-sidebar">
        <div className="config-section-link">Vault</div>
        <div className="config-section-link">AI</div>
        <div className="config-section-link">Git</div>
        <div className="config-section-link">Judgement Brain</div>
        <div className="config-section-link">Performance</div>
      </div>
      
      <div className="config-content">
        {/* 各セクションのコンテンツ */}
      </div>
    </div>
  );
}
```

---

## 開発フェーズマッピング

### Phase 1: エディタ基本機能（要件1-7, 15-17, 20）

**目標**: Obsidianの代わりに毎日使えるエディタ

**実装コンポーネント**:
- ✅ Editor Core (CodeMirror 6)
- ✅ Vault Manager (ファイルI/O)
- ✅ File Watcher
- ✅ Git Manager
- ✅ Activity Logger (基本)
- ✅ Configuration Manager
- ✅ Tauri v2 Shell

**成果物**:
- Markdownエディタとして完全に機能
- Obsidian vaultの読み書き可能
- Git自動commit
- 行動ログ記録開始

**依存関係**: なし（最初のフェーズ）

---

### Phase 2: 検索と記憶（要件8-9）

**目標**: 過去の自分にアクセスできる

**実装コンポーネント**:
- ✅ Embedding Engine
- ✅ Margin Annotation Panel (関連ノートのみ)
- ✅ ModelBackend trait
- ✅ LlamaCpp Backend
- ✅ Database Layer (embedding テーブル)

**成果物**:
- ノートのembedding生成・保存
- マージン注釈で関連ノート表示
- ModelBackend traitの整備

**依存関係**: Phase 1完了後

---

### Phase 3: Judgement Brain本体（要件10-14）

**目標**: 思考の蓄積から自己理解が生まれる

**実装コンポーネント**:
- ✅ Contradiction Detector
- ✅ BibTeX Parser
- ✅ Paper Linker
- ✅ Summary Generator
- ✅ Background Scheduler
- ✅ Gemma 3 1B Integration
- ✅ Ollama Backend (拡張)

**成果物**:
- 矛盾・一致検出
- 論文自動紐付け
- 強み・弱みの週次サマリ
- バックグラウンド推論スケジューラ

**依存関係**: Phase 2完了後

---

### Phase 4: 行動ログ統合・検索強化（要件12の拡張）

**目標**: 情報の入口を統合する

**実装コンポーネント**:
- ✅ Full-text Search (tantivy)
- ✅ Semantic Search
- ✅ Activity Statistics
- ✅ Browser Extension (将来)
- ✅ Advanced Filtering

**成果物**:
- 全文検索機能
- セマンティック検索UI
- 活動パターン分析
- ブラウザ拡張との連携（オプション）

**依存関係**: Phase 3完了後

---

## 実装優先度

### 高優先度（Phase 1-2）
1. CodeMirror 6統合
2. ファイルI/O
3. wikiリンク解決
4. Embedding生成
5. マージン注釈UI

### 中優先度（Phase 3）
1. Gemma 3 1B統合
2. 矛盾検出
3. BibTeX解析
4. 週次サマリ

### 低優先度（Phase 4以降）
1. 全文検索
2. ブラウザ拡張
3. 高度なフィルタリング

---

## リスク管理

### 技術的リスク

| リスク | 影響度 | 対策 |
|---|---|---|
| Gemma推論が遅い | 高 | q4_0量子化、キャッシング、バックグラウンド実行 |
| メモリ不足 | 高 | メモリプーリング、段階的ロード、キャッシュ制限 |
| ファイル競合 | 中 | ファイルロック、コンフリクト検出、マージ戦略 |
| LSP接続失敗 | 低 | グレースフルデグラデーション、フォールバック |

### パフォーマンスリスク

| 要件 | 目標 | リスク | 対策 |
|---|---|---|---|
| ファイルツリー表示 | 2秒 | 大規模vault | 仮想スクロール、段階的ロード |
| キーストローク応答 | 50ms | 複雑なハイライト | 差分更新、非同期処理 |
| Embedding生成 | 5秒 | 大規模ノート | バッチ処理、キャッシング |
| Gemma推論 | 30秒 | CPU負荷 | スケジューリング、優先度制御 |

---

## 今後の拡張可能性

### 短期（6ヶ月以内）
- ブラウザ拡張（Webクリップ）
- Obsidian プラグイン互換性
- 複数言語サポート

### 中期（6-12ヶ月）
- モバイルアプリ（React Native）
- クラウド同期（オプション、E2E暗号化）
- より大型のLLM対応（Ollama経由）

### 長期（12ヶ月以上）
- 音声入力
- 画像認識
- グラフビジュアライゼーション
- チーム協調編集

