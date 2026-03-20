# マージン注釈のembeddingとグラフパネルが未統合

## 問題

マージン注釈（Judgement Brain）とグラフパネルは **完全に別システム** として動作している:
- マージン注釈: Ollama + nomic-embed-text → SQLite → cosine similarity
- グラフパネル: Vertex AI (Gemini) → キーワード抽出 → グルーピング

共有するデータ構造やembeddingの再利用がない。

## 影響

- 同じファイルに対して異なるAIバックエンドが別々に分析する冗長性
- embedding類似度をグラフのエッジ重みに活用できていない
- ユーザーから見て2つの機能の整合性が取れない可能性

## 該当コード

- `src-tauri/src/database.rs` — embedding保存・検索
- `src-tauri/src/commands.rs` — グラフ分析（embeddingを参照せず）
