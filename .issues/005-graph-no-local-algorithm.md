# 論理グルーピングが完全にLLM依存

## 問題

ファイルのグルーピングと階層化は **すべてGemini APIに依存** しており、ローカルのアルゴリズム（k-meansクラスタリング等）がない。
既にローカルで生成している embedding ベクトルが活用されていない。

## 影響

- Vertex AI の設定がないとグラフ機能が一切使えない
- ローカルファーストの設計哲学に反する
- embeddingとグラフが別システムで冗長

## 該当コード

- `src-tauri/src/commands.rs` — Phase 1〜3 すべてGemini API呼び出し
- `src-tauri/src/database.rs` — embeddingは保存済みだがグラフに未使用
