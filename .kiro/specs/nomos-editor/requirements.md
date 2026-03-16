# Nomos 要件定義書

## はじめに

Nomosは、ローカルLLMを活用した知識管理エディタです。ユーザーの思考の蓄積をローカルで処理し、外部APIに一切依存せずに自己理解を深めるアシスタント機能を提供します。Obsidianの完全な置き換えを目指し、毎日使うメインツールとして設計されています。

**ビジョン:** 「自分のデジタルツインをローカルで育てるエディタ」

**コアコンセプト:**
- 外部サービス依存ゼロ（すべてのAI推論がローカルで実行）
- データ所有権の完全性（すべてのデータがローカルに保存）
- Obsidian互換性（既存vaultの読み書き可能）
- モデルのプラガビリティ（特定のLLMに依存しない設計）

---

## 用語集

- **Vault**: Markdownファイルを格納するディレクトリ。Obsidian互換の構造を採用
- **Judgement Brain**: エディタの右マージンに表示される注釈システム。関連ノート、矛盾検出、論文リンク、サマリを表示
- **Embedding**: テキストを数値ベクトルに変換する処理。ノート間の意味的類似性を計算するために使用
- **ModelBackend**: AI推論を実行するバックエンド。llama.cpp、Ollama等の実装を切り替え可能
- **行動ログ**: ユーザーのファイル操作（開く、編集、閉じる）を記録するログ
- **マージン注釈**: エディタ右側に表示される薄い情報パネル。書きながら自然に気づく設計
- **BibTeX**: 学術論文の参考文献を管理するテキスト形式
- **LSP**: Language Server Protocol。コード補完やエラー検出を提供するプロトコル
- **wikiリンク**: `[[ノート名]]` 形式のリンク。Obsidian互換
- **バックリンク**: あるノートを参照している他のノートへのリンク

---

## 要件

### 要件1: Markdownエディタの基本機能

**ユーザーストーリー:** ユーザーとして、Markdownファイルを快適に編集したいので、シンタックスハイライトと基本的な編集機能が必要です。

#### 受け入れ基準

1. THE Editor SHALL support CommonMark specification for Markdown syntax
2. WHEN a Markdown file is opened, THE Editor SHALL display syntax highlighting for all CommonMark elements
3. WHEN code blocks are present, THE Editor SHALL apply language-specific syntax highlighting based on the declared language
4. THE Editor SHALL support undo/redo operations with unlimited history
5. WHEN text is modified, THE Editor SHALL automatically save changes to the file system within 1 second
6. THE Editor SHALL display line numbers and column position indicators
7. WHEN a user searches for text, THE Editor SHALL highlight all matches and navigate between them

---

### 要件2: wikiリンクとバックリンク機能

**ユーザーストーリー:** ユーザーとして、ノート間を相互参照したいので、wikiリンク形式でノートを接続し、バックリンクを表示する必要があります。

#### 受け入れ基準

1. WHEN a user types `[[note_name]]`, THE Editor SHALL recognize it as a wikilink and apply distinct styling
2. WHEN a wikilink is clicked, THE Editor SHALL open the referenced note if it exists
3. WHEN a note is opened, THE Backlink_Panel SHALL display all notes that reference the current note
4. WHEN a referenced note is deleted, THE Editor SHALL mark the wikilink as broken and display a warning indicator
5. WHEN a note is renamed, THE Editor SHALL update all wikilinks that reference the old name

---

### 要件3: Vault管理とファイルシステム操作

**ユーザーストーリー:** ユーザーとして、複数のvaultを管理し、ファイルシステムと同期したいので、ローカルファイルの直接操作が必要です。

#### 受け入れ基準

1. WHEN Nomos starts, THE Application SHALL read the vault path from config.toml
2. THE File_Tree SHALL display all Markdown files in the vault directory
3. WHEN a file is created in the vault directory by external tools, THE File_Tree SHALL automatically refresh within 2 seconds
4. WHEN a user creates a new note in Nomos, THE File_System SHALL create a corresponding .md file
5. WHEN a user deletes a note in Nomos, THE File_System SHALL move the file to a trash directory instead of permanent deletion
6. THE Application SHALL support multiple vault configurations via config.toml
7. WHEN a vault is switched, THE Application SHALL load the new vault's files and display them in the File_Tree

---

### 要件4: Obsidian互換性

**ユーザーストーリー:** ユーザーとして、既存のObsidian vaultをそのまま使いたいので、完全な互換性が必要です。

#### 受け入れ基準

1. THE Application SHALL read and write Markdown files in the same format as Obsidian
2. WHEN an Obsidian vault is opened, THE Application SHALL preserve all existing metadata and frontmatter
3. THE Application SHALL support Obsidian's `.obsidian/` configuration directory (read-only)
4. WHEN wikilinks are used, THE Application SHALL follow Obsidian's link resolution rules
5. THE Application SHALL support Obsidian's tag syntax (#tag)
6. WHEN a file is edited in both Nomos and Obsidian simultaneously, THE Application SHALL detect conflicts and prompt the user to resolve them

---

### 要件5: Git統合と変更履歴管理

**ユーザーストーリー:** ユーザーとして、編集履歴を追跡したいので、Git統合が必要です。

#### 受け入れ基準

1. WHEN a file is saved, THE Git_Manager SHALL automatically commit the changes if Git integration is enabled
2. THE Application SHALL display a diff view showing changes between the current version and the last commit
3. WHEN a user requests it, THE Git_Manager SHALL display the commit history for the current file
4. THE Application SHALL allow users to enable/disable automatic commits via config.toml
5. WHEN automatic commits are enabled, THE Git_Manager SHALL use gitoxide for all Git operations
6. WHEN a commit is made, THE Git_Manager SHALL include a timestamp and file path in the commit message

---

### 要件6: LSP統合とコード編集

**ユーザーストーリー:** ユーザーとして、コードブロック内でコード補完やエラー検出を使いたいので、LSP統合が必要です。

#### 受け入れ基準

1. WHEN a code block with a language identifier is present, THE Editor SHALL attempt to connect to the corresponding LSP server
2. WHEN LSP is connected, THE Editor SHALL display code completions as the user types
3. WHEN LSP detects errors, THE Editor SHALL display inline error indicators with descriptions
4. WHEN a user hovers over a symbol, THE Editor SHALL display type information if available from LSP
5. THE Application SHALL support configuration of LSP servers via config.toml
6. IF an LSP server is unavailable, THE Editor SHALL continue functioning without LSP features

---

### 要件7: 行動ログの記録

**ユーザーストーリー:** ユーザーとして、自分の編集パターンを分析したいので、行動ログが必要です。

#### 受け入れ基準

1. WHEN a file is opened, THE Activity_Logger SHALL record the action with a timestamp
2. WHEN a file is edited, THE Activity_Logger SHALL record the action and the duration of editing
3. WHEN a file is closed, THE Activity_Logger SHALL record the action and total editing time
4. THE Activity_Logger SHALL store all logs in SQLite database at ~/.local/share/nomos/nomos.db
5. WHEN a user requests it, THE Application SHALL display activity statistics (files edited, time spent, etc.)
6. THE Activity_Logger SHALL not impact editor performance (logging must be asynchronous)

---

### 要件8: Embedding生成とベクトル化

**ユーザーストーリー:** ユーザーとして、ノート間の意味的な関連性を自動検出したいので、embeddingが必要です。

#### 受け入れ基準

1. WHEN a note is saved, THE Embedding_Engine SHALL generate a vector representation of the note content
2. THE Embedding_Engine SHALL use nomic-embed-text or equivalent lightweight model
3. THE Embedding_Engine SHALL store embeddings in SQLite with the file path as the key
4. WHEN embeddings are generated, THE Embedding_Engine SHALL update the timestamp in the database
5. THE Embedding_Engine SHALL process embeddings asynchronously without blocking the editor
6. WHEN a note is deleted, THE Embedding_Engine SHALL remove the corresponding embedding from the database

---

### 要件9: Judgement Brain - マージン注釈UI

**ユーザーストーリー:** ユーザーとして、書きながら関連情報を自然に発見したいので、マージン注釈が必要です。

#### 受け入れ基準

1. WHEN a note is being edited, THE Margin_Annotation_Panel SHALL display on the right side of the editor
2. THE Margin_Annotation_Panel SHALL show related past notes based on embedding similarity
3. WHEN embedding similarity exceeds 0.75, THE Margin_Annotation_Panel SHALL display the related note with a 💡 icon
4. THE Margin_Annotation_Panel SHALL not block editor input or cause performance degradation
5. WHEN a user clicks on a related note in the margin, THE Application SHALL open that note
6. THE Margin_Annotation_Panel SHALL update in real-time as the user types (with debouncing)
7. WHEN the editor is not in focus, THE Margin_Annotation_Panel SHALL remain visible but not update

---

### 要件10: Judgement Brain - 矛盾検出

**ユーザーストーリー:** ユーザーとして、過去の自分の思考との矛盾に気づきたいので、矛盾検出が必要です。

#### 受け入れ基準

1. WHEN a note is saved, THE Contradiction_Detector SHALL analyze the content against past notes using Gemma inference
2. WHEN a contradiction is detected, THE Margin_Annotation_Panel SHALL display it with a ⚡ icon
3. THE Contradiction_Detector SHALL run asynchronously in the background without blocking the editor
4. WHEN a contradiction is displayed, THE User SHALL be able to click it to view the conflicting past note
5. THE Contradiction_Detector SHALL only run when the user is idle for more than 2 seconds
6. WHEN Gemma inference is unavailable, THE Contradiction_Detector SHALL gracefully degrade and not display contradictions

---

### 要件11: Judgement Brain - 論文・文献リンク

**ユーザーストーリー:** ユーザーとして、自分の思考と学術論文を自動的に紐付けたいので、BibTeX統合が必要です。

#### 受け入れ基準

1. WHEN a BibTeX file is present in the vault, THE BibTeX_Parser SHALL parse all entries
2. WHEN a note is saved, THE Paper_Linker SHALL search for related papers using embedding similarity
3. WHEN a related paper is found, THE Margin_Annotation_Panel SHALL display it with a 📄 icon
4. WHEN a user clicks on a paper link, THE Application SHALL display the BibTeX entry and related metadata
5. THE Paper_Linker SHALL support citation tracking (showing which notes cite which papers)
6. WHEN a BibTeX file is updated, THE Application SHALL automatically reload the entries

---

### 要件12: Judgement Brain - 週次サマリ生成

**ユーザーストーリー:** ユーザーとして、自分の強みと弱みを定期的に把握したいので、週次サマリが必要です。

#### 受け入れ基準

1. WHEN a week ends, THE Summary_Generator SHALL analyze all notes and activity logs from that week
2. THE Summary_Generator SHALL use Gemma inference to generate a summary of strengths and weaknesses
3. THE Summary_Generator SHALL run as a background batch job (not blocking the editor)
4. WHEN a summary is generated, THE Application SHALL store it in SQLite and display it in a dedicated view
5. THE Summary_Generator SHALL include insights from activity logs (time spent, files edited, patterns)
6. WHEN a user requests it, THE Application SHALL display historical summaries for previous weeks

---

### 要件13: ModelBackend トレイト設計

**ユーザーストーリー:** ユーザーとして、異なるAIモデルを切り替えたいので、プラガブルなバックエンド設計が必要です。

#### 受け入れ基準

1. THE ModelBackend trait SHALL define generate() and embed() methods
2. THE Default_Implementation SHALL use llama.cpp with Gemma 3 1B GGUF model
3. WHEN config.toml specifies a different backend, THE Application SHALL load the specified backend
4. THE Ollama_Backend SHALL support connecting to Ollama instances for larger models
5. WHEN a backend is unavailable, THE Application SHALL fall back to the default backend
6. THE ModelBackend trait SHALL be extensible for future implementations

---

### 要件14: ローカルLLM統合 - Gemma 3 1B

**ユーザーストーリー:** ユーザーとして、外部APIに依存せずにAI機能を使いたいので、ローカルLLM統合が必要です。

#### 受け入れ基準

1. THE Application SHALL download and cache Gemma 3 1B GGUF model on first run
2. THE Model SHALL be quantized to Q4_K_M format (approximately 600MB)
3. WHEN inference is requested, THE Application SHALL load the model into memory and generate responses
4. THE Inference_Engine SHALL support CPU-only execution
5. WHEN inference completes, THE Application SHALL cache the result for 1 hour
6. IF model loading fails, THE Application SHALL display an error message and disable AI features

---

### 要件15: 設定管理

**ユーザーストーリー:** ユーザーとして、アプリケーションの動作をカスタマイズしたいので、設定ファイルが必要です。

#### 受け入れ基準

1. THE Application SHALL read configuration from ~/.config/nomos/config.toml
2. THE Configuration SHALL include vault path, model settings, and feature toggles
3. WHEN config.toml is modified, THE Application SHALL reload settings without restarting
4. THE Configuration SHALL support multiple vault profiles
5. WHEN a required configuration is missing, THE Application SHALL use sensible defaults
6. THE Configuration file SHALL be human-readable TOML format

---

### 要件16: データベーススキーマ

**ユーザーストーリー:** ユーザーとして、行動ログとメタデータを永続化したいので、SQLiteスキーマが必要です。

#### 受け入れ基準

1. THE Database SHALL store activity logs with file_path, action, timestamp, and duration_sec
2. THE Database SHALL store note embeddings with file_path, embedding vector, and updated_at
3. THE Database SHALL store weekly summaries with week identifier, content, and generated_at
4. WHEN the database is accessed, THE Application SHALL use connection pooling for performance
5. THE Database schema SHALL be versioned for future migrations
6. WHEN the database is corrupted, THE Application SHALL attempt recovery or reinitialize

---

### 要件17: ファイル変更監視

**ユーザーストーリー:** ユーザーとして、外部ツールで編集されたファイルを自動検出したいので、ファイル監視が必要です。

#### 受け入れ基準

1. WHEN a file in the vault is modified by external tools, THE File_Watcher SHALL detect the change within 2 seconds
2. WHEN a change is detected, THE Application SHALL reload the file content
3. IF the file is currently open in the editor, THE Application SHALL prompt the user to reload or merge changes
4. THE File_Watcher SHALL not consume excessive CPU resources
5. WHEN the vault directory is moved, THE File_Watcher SHALL continue monitoring the new location

---

### 要件18: パフォーマンス要件

**ユーザーストーリー:** ユーザーとして、大規模なvaultでも快適に使いたいので、パフォーマンスが重要です。

#### 受け入れ基準

1. WHEN a vault with 10,000 notes is opened, THE Application SHALL display the file tree within 2 seconds
2. WHEN a note is opened, THE Editor SHALL display the content within 500ms
3. WHEN a user types, THE Editor SHALL respond within 50ms (no perceptible lag)
4. WHEN embedding generation is triggered, THE Application SHALL complete within 5 seconds per note
5. WHEN Gemma inference is requested, THE Application SHALL complete within 30 seconds
6. THE Application memory usage SHALL not exceed 2GB during normal operation

---

### 要件19: セキュリティとデータプライバシー

**ユーザーストーリー:** ユーザーとして、自分のデータが安全に保護されたいので、セキュリティが必要です。

#### 受け入れ基準

1. THE Application SHALL not send any data to external servers
2. ALL data SHALL be stored locally in the user's home directory
3. THE Database file SHALL be readable only by the current user (file permissions 0600)
4. WHEN a note is deleted, THE Application SHALL move it to trash instead of permanent deletion
5. THE Application SHALL not store passwords or sensitive credentials in plain text
6. WHEN the application exits, THE Application SHALL properly close all database connections

---

### 要件20: クロスプラットフォーム対応

**ユーザーストーリー:** ユーザーとして、複数のOSで使いたいので、クロスプラットフォーム対応が必要です。

#### 受け入れ基準

1. THE Application SHALL run on Windows, macOS, and Linux
2. WHEN the application starts, THE Application SHALL detect the operating system and use appropriate file paths
3. THE Application SHALL use Tauri v2 for cross-platform compatibility
4. WHEN a file path is used, THE Application SHALL normalize it for the current OS
5. THE Application SHALL handle OS-specific file system differences (case sensitivity, path separators)

---

## 非機能要件

### パフォーマンス

- エディタの応答時間: 50ms以下
- ファイルツリー表示: 2秒以下（10,000ノート時）
- Embedding生成: 5秒以下/ノート
- Gemma推論: 30秒以下
- メモリ使用量: 2GB以下

### スケーラビリティ

- 最大10,000ノートのvaultに対応
- 最大100,000行のノートに対応
- 最大1,000個のwikiリンクを含むノートに対応

### 信頼性

- 自動保存により編集内容の損失を防止
- ファイル変更の自動検出と競合解決
- データベース破損時の自動復旧

### セキュリティ

- すべてのデータをローカルに保存
- 外部APIへの通信なし
- ファイルパーミッション管理（0600）
- 削除ファイルのゴミ箱移動

### ユーザビリティ

- Obsidian互換のUI/UX
- 直感的なマージン注釈表示
- 設定ファイルによるカスタマイズ

---

## 制約と仮定

### 制約

1. **ローカル実行**: すべてのAI推論はローカルで実行される必要があります
2. **モデルサイズ**: Gemma 3 1B GGUF（Q4_K_M）は600MB以下である必要があります
3. **CPU動作**: GPU不要で、CPUのみで動作する必要があります
4. **ファイルシステム**: Obsidian互換のファイル構造を維持する必要があります

### 仮定

1. ユーザーは最低限のコンピュータリソース（4GB RAM、2GHz CPU）を持っていると仮定
2. ユーザーのvaultは最大10,000ノートであると仮定
3. ネットワーク接続は不要であると仮定
4. ユーザーはconfig.tomlを手動で編集できると仮定

---

## 成功基準

1. **エディタとして使える**: Obsidianと同等の基本機能を提供
2. **ローカル実行**: 外部APIに一切依存しない
3. **パフォーマンス**: 大規模vaultでも快適に動作
4. **Judgement Brain**: マージン注釈で関連情報を自然に発見できる
5. **データ所有権**: すべてのデータがローカルに保存される
6. **拡張性**: ModelBackendトレイトで異なるモデルに対応可能

---

## 開発フェーズ

### Phase 1: エディタ基本機能
要件1-7, 15-17, 20に対応

### Phase 2: 検索と記憶
要件8-9に対応

### Phase 3: Judgement Brain本体
要件10-14に対応

### Phase 4: 行動ログ統合・検索強化
要件12の拡張に対応
