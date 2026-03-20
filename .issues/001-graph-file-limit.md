# グラフ分析の30ファイル上限

## 問題

`analyze_vault_for_graph` (`src-tauri/src/commands.rs`) で `.md` ファイルの収集が **30件でbreak** する。
大規模Vaultでは一部のファイルしか分析されず、走査順はファイルシステム依存のため **どのファイルが選ばれるか予測不能**。

## 影響

- Vaultの全体像がグラフに反映されない
- ユーザーが意図しないファイルが欠落する

## 該当コード

- `src-tauri/src/commands.rs` — `md_files.len() >= 30` の条件
