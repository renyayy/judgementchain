# 隠しディレクトリがグラフ分析に混入する

## 問題

`analyze_vault_for_graph` は `walkdir` で全ディレクトリを走査するが、`.obsidian/`, `.git/`, `.trash/` 等の **隠しディレクトリを除外していない**。
一方、`vault.rs` の `list_files()` は `.` で始まるディレクトリを正しくスキップしている。

## 影響

- システムファイルがグラフノードに表示される
- グルーピングの精度が下がる

## 該当コード

- `src-tauri/src/commands.rs` — `walkdir::WalkDir::new()` にフィルタなし
- `src-tauri/src/vault.rs` — `list_files()` は正しく除外（参考実装）
