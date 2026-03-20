# embeddingベースのローカルクラスタリングを追加

**対応issue**: `.issues/005-graph-no-local-algorithm.md`
**状態**: backlog

## やること

- 既存の `note_embeddings` テーブルのベクトルを使ったローカルクラスタリングを実装
- アルゴリズム候補: k-means, hierarchical agglomerative clustering
- Vertex AI が未設定の場合はローカルクラスタリングにフォールバック
- Vertex AI が設定済みの場合はローカル結果とLLM結果のハイブリッドも検討

## 該当ファイル

- `src-tauri/src/commands.rs` — ローカルクラスタリングロジック追加
- `src-tauri/src/database.rs` — embedding取得クエリ
