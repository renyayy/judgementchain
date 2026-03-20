# グラフ分析結果をSQLiteにキャッシュ

**対応issue**: `.issues/004-graph-no-cache.md`
**状態**: backlog

## やること

- SQLiteに `graph_cache` テーブルを追加（vault_path, graph_json, analyzed_at, file_hashes）
- 分析結果をJSONとして保存し、ファイル変更がなければキャッシュから返す
- ファイルのハッシュ変更を検知して自動的にキャッシュを無効化する

## 該当ファイル

- `src-tauri/src/database.rs` — テーブル追加
- `src-tauri/src/commands.rs` — キャッシュ判定ロジック
