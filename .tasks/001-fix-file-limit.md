# ファイル上限を設定化または撤廃する

**対応issue**: `.issues/001-graph-file-limit.md`
**状態**: backlog

## やること

- `analyze_vault_for_graph` のハードコーディングされた30件上限を `config.toml` の設定値に変更する
- デフォルト値は十分大きくするか、制限なしにする
- Gemini APIのトークン上限を考慮し、バッチサイズの調整も検討する

## 該当ファイル

- `src-tauri/src/commands.rs`
- `src-tauri/src/config.rs`
