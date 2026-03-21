# judgement-chain

ハッカソンチーム: **Judgement Chain**

Tauri v2 + React + CodeMirror 6 で作る、ローカルファーストの知識管理エディタ「Nomos / Judgement Brain」です。

## つくったもの

**Vault（Obsidian互換のMarkdownノート）に“考えの履歴”を溜め、右マージンに関連・矛盾・文献を出す**ことで、書く行為そのものが学習ループになります。  
関連ノートは埋め込み類似度、矛盾はGemma推論、文献はBibTeX+類似度、週次サマリも生成する設計です。

## ハッカソン審査観点（a〜d）

### a. テーマ性

テーマ「**Brand New "Hello World."**」への答えは、単なるデモの“Hello”ではなく、**書き始めた瞬間に「思考の変化」が見える**体験です。  
例えばノート編集中に、右マージンへ
- 💡「いまの文章に近い過去のノート」
- ⚡「過去との矛盾候補」
- 📄「関連しそうな文献」
- 📊「週次の強み/改善点」
が“追記されていく”ことで、Hello World は「文章出力」ではなく **思考の再構築**へ置き換わります。  
この体験は、`src-tauri/src/commands.rs`（マージン注釈取得・矛盾検出・サマリ生成）と、`src/App.tsx`（編集→注釈更新・矛盾検出のアイドル実行）で実装しています。

### b. 制作したプロダクトの再現性

デモとして目的を達成できるよう、UIと処理系を「分かりやすい導線」と「失敗しても壊れない挙動」に寄せています。

デモ手順（例）
1. アプリ起動 → vault を開く（Tauriのファイル/ディレクトリ選択）
2. 右パネル `AI (Gemma)` で **モデルロード**
3. ノートを編集 → 右マージンに関連注釈が出る
4. 2秒ほど操作を止める → ⚡矛盾検出が走り、候補が出る
5. 右パネル `Graph` で `分析` → Vertex AI（Gemini）によりネットワーク図が描画される（設定不足ならエラー/案内表示）

堅牢性・拡張性の根拠
- **重い処理を非同期化**: モデルロード/推論は `spawn_blocking` でワーカへ逃がし、UIフリーズを避けます（`src-tauri/src/commands.rs`）。
- **graceful degradation**: `detect_contradictions` はモデル未ロード時に空配列を返し、アプリ全体を止めません（`src-tauri/src/commands.rs`）。
- **負荷対策**: `memory_budget` によるモデルロード前チェック（`src-tauri/src/memory_budget.rs`）と、編集→注釈更新のデバウンス（`src/App.tsx`）。
- **エラー表示と継続**: Vertex AIグラフ解析は UI側で `status=error` として表示します（`src/components/GraphPanel.tsx`）。

### c. Google技術をうまく活用できているか

このプロダクトは、**“ローカル推論（Gemma）”と“Googleクラウド（Vertex AI / Gemini）”を役割分担**して完成度を上げています。

Gemma（ローカル）側
- Candle + GGUFで **バンドル済みのGemma系モデル**をローカル推論します（`src-tauri/src/ai.rs`）。
- **モデル候補のフォールバック**（存在するものを優先）と、GPU/Metal/CUDA検出→失敗時はCPUへフォールバックする設計です（`src-tauri/src/ai.rs`）。
- UIではバックエンドが `vertex` の場合のみGemma利用規約同意を表示し、同意状態を`localStorage`で管理しています（`src/App.tsx`, `src/components/GemmaTermsModal.tsx`）。

Vertex AI / Gemini（クラウド）側（Graph）
- **サービスアカウント認証をフロントに出さずRustバックエンド内で完結**させています（`src-tauri/src/vertex_ai.rs`、`src-tauri/src/commands.rs`）。
- JWT署名→OAuthトークン取得→Gemini API呼び出しまで一貫して実装し、レスポンスが配列/オブジェクトどちらでもパースできるようにしています（`src-tauri/src/vertex_ai.rs`）。
- Graphは「キーワード抽出→グループ化→階層化」の複数ステップで、結果を`cytoscape`でネットワーク図として描画します（`src-tauri/src/commands.rs`, `src/components/GraphPanel.tsx`, `.kiro/specs/graph-panel/design.md`）。

このように **Google AIを“使うだけ”ではなく、認証・フォールバック・パース・UI反映まで含めて設計**できている点が、実現難易度と完成度に繋がっています。

### d. 異端性

通常のLLMアプリと比べて、以下の点が強い“異端性”です。
- **Obsidian互換のvault上で“思考の履歴”を育てる**: 右マージンが関連・矛盾・文献の入口になり、編集がそのまま知識化される構造（`src-tauri/src/commands.rs`, `src/App.tsx`）。
- **ローカル/クラウドの役割分担**: 矛盾検出などの推論はGemmaローカル、グラフ可視化はVertex AIで意味構造を作る（`src-tauri/src/ai.rs`, `src-tauri/src/vertex_ai.rs`）。
- **“プラグイン機構”をvaultにローカルコードとして実装**し、拡張の例外が他機能へ波及しにくい安全設計（`src/plugins/loader.ts`, `.kiro/specs/plugin-system/requirements.md`）。

## デモ用ワンフレーズ

**「Hello World」を“思考の更新”に変える、ローカル×Google AI知識管理。**

## モデルカード/ライセンス

Gemmaのモデルカード本文や取り扱いは、こちらに集約しています:  
`src-tauri/models/README.md`

