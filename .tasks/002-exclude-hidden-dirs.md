# 隠しディレクトリ除外フィルタを追加

**対応issue**: `.issues/002-graph-hidden-dir-leak.md`
**状態**: backlog

## やること

- `analyze_vault_for_graph` の `walkdir` 走査に、`.` で始まるディレクトリのスキップを追加
- `vault.rs` の `list_files()` と同じフィルタリングロジックを適用する（共通化を検討）

## 該当ファイル

- `src-tauri/src/commands.rs`
- `src-tauri/src/vault.rs`（参考実装）
