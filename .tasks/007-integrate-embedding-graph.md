# embedding類似度をグラフのエッジ重みに活用

**対応issue**: `.issues/007-embedding-graph-not-integrated.md`
**状態**: backlog

## やること

- グラフ構築時に `note_embeddings` からファイル間のcosine similarityを取得
- 類似度をグラフのエッジ重みとして反映（太さ・色で可視化）
- キーワードベースのグルーピングとembedding類似度の併用を検討

## 該当ファイル

- `src-tauri/src/commands.rs` — グラフ構築にembedding類似度を組み込む
- `src-tauri/src/database.rs` — 全ペアの類似度取得
- `src/components/GraphPanel.tsx` — エッジの視覚的表現
