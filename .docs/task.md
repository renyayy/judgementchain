# task.md（作業の入口）

このリポジトリの作業は **Spec駆動（Requirements → Design → Tasks → Implementation）** で進めます。  
運用ルールは `AGENTS.md`、進捗の単一ソースは `TASKS.md` です。

---

## まず見るもの

- **運用ルール**: `AGENTS.md`
- **全体タスクボード（単一ソース）**: `TASKS.md`
- **仕様（Spec）**: `.kiro/specs/`
- **テンプレ（PRD/Design）**: `.docs/PRD.md` / `.docs/DesignDoc.md`

---

## 現在の対象（アクティブ想定）

- `nomos-editor`
  - 要件: `.kiro/specs/nomos-editor/requirements.md`
  - 設計: `.kiro/specs/nomos-editor/design.md`
  - タスク（未作成なら作る）: `.kiro/specs/nomos-editor/tasks.md`

---

## 進め方（最短）

1. `TASKS.md` の「Next」から1件を **in_progress** にする  
2. 対象Specの `requirements.md` と `design.md` の該当箇所を確認  
3. 変更を実装し、必要最小限の検証を行う  
4. `TASKS.md` を更新して完了条件を満たしたことを記録  

---

## 完了の定義（DoD）

- Spec（要件・設計）とタスクの紐付けが明確
- 影響範囲が過剰に広がっていない
- 可能な範囲で検証（lint / unit / 手動確認）が実施され、結果が `TASKS.md` に残っている

