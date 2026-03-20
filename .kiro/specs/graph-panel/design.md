# Design: Vertex AI グラフ可視化パネル

## 概要

Gemma（Candle）のローカル推論からGoogle Vertex AI（Gemini）のAPI呼び出しへ切り替え、
ファイル間の関連をキーワード抽出→グルーピング→ネットワーク図で可視化する機能を追加する。

---

## アーキテクチャ決定

### API呼び出し位置：バックエンド（Rust）

| 観点 | フロントエンド（fetch） | バックエンド（Rust）✅ |
|---|---|---|
| サービスアカウントJSONの安全性 | ✗ JSからアクセス可能 | ✅ Rust内で完結 |
| CSP変更 | 必要（複数Googleエンドポイント） | 不要 |
| JWT署名（RSA256） | WebCrypto API必要（複雑） | 標準crateで容易 |
| 実装の複雑さ | △ 認証が特に複雑 | ○ reqwest + jsonwebtoken |

→ **サービスアカウントJSON認証はバックエンド（Rust）で処理する。**

### グラフ描画ライブラリ：Cytoscape.js

- `@types/cytoscape` は既インストール済み
- `dagre` レイアウトで階層グラフを表現
- ホバーtoolipはDOM要素で実装（cytoscape-popperは不使用）

---

## データ構造

### TypeScript型（`src/types/index.ts` に追加）

```typescript
export interface FileGraphNode {
  id: string;          // ファイルパス（一意）
  type: "file";
  label: string;       // ファイル名（basename）
  path: string;        // フルパス（onOpenFileに渡す）
  keywords: string[];
  groupId: string;     // 所属する末端グループのid
}

export interface GroupGraphNode {
  id: string;          // "group_0", "group_1" etc.
  type: "group";
  label: string;       // ジャンル名（Geminiが付与）
  level: number;       // 1=末端グループ, 2=中間, 3=トップ（最大2個）
  childIds: string[];
}

export type GraphNode = FileGraphNode | GroupGraphNode;

export interface GraphEdge {
  id: string;
  source: string;  // 子ノードid
  target: string;  // 親グループid
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type AnalysisStatus = "idle" | "analyzing" | "done" | "error";
```

### Rust型（`vertex_ai.rs` + `commands.rs`）

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNodeData {
    pub id: String,
    pub node_type: String,   // "file" | "group"
    pub label: String,
    pub path: Option<String>,
    pub keywords: Vec<String>,
    pub level: u32,
    pub group_id: Option<String>,
    pub child_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdgeData {
    pub id: String,
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNodeData>,
    pub edges: Vec<GraphEdgeData>,
}
```

---

## 設定拡張（`config.rs`）

`AiConfig` に以下を追加：

```rust
#[serde(default)]
pub vertex_ai_service_account_path: String,   // サービスアカウントJSONのパス
#[serde(default)]
pub vertex_ai_project_id: String,             // GCPプロジェクトID
#[serde(default = "default_vertex_location")]
pub vertex_ai_location: String,               // デフォルト: "us-central1"
#[serde(default = "default_vertex_model")]
pub vertex_ai_model: String,                  // デフォルト: "gemini-2.0-flash-001"
```

`config.toml` 設定例：

```toml
[ai]
vertex_ai_service_account_path = "~/.config/nomos/vertex-sa.json"
vertex_ai_project_id = "my-gcp-project"
vertex_ai_location = "us-central1"
vertex_ai_model = "gemini-2.0-flash-001"
```

---

## Rust実装：`src-tauri/src/vertex_ai.rs`

### JWT認証フロー

```
1. サービスアカウントJSON読み込み（client_email, private_key）
2. JWT Claims作成:
   iss = client_email
   scope = "https://www.googleapis.com/auth/cloud-platform"
   aud = "https://oauth2.googleapis.com/token"
   iat = now, exp = now + 3600
3. RS256でJWT署名
4. POST https://oauth2.googleapis.com/token
   grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion={jwt}
5. access_token を取得
```

### Gemini API呼び出し

```
POST https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:generateContent
Authorization: Bearer {access_token}
Content-Type: application/json

{
  "contents": [{"role": "user", "parts": [{"text": "..."}]}],
  "generationConfig": { "responseMimeType": "application/json" }
}
```

### 主要関数

```rust
pub async fn get_access_token(service_account_path: &str) -> Result<String, String>
pub async fn call_gemini(token: &str, project: &str, location: &str, model: &str, prompt: &str) -> Result<String, String>
```

---

## Tauriコマンド：`analyze_vault_for_graph`

```rust
#[tauri::command]
pub async fn analyze_vault_for_graph(
    dir_path: String,
    state: tauri::State<'_, AppState>,
) -> Result<GraphData, String>
```

### 処理フロー

```
Phase 1: ファイル収集
  → .md ファイルを最大30件取得（vault::list_files 流用）
  → 各ファイルの先頭500文字を読み込み

Phase 2: キーワード抽出（ceil(N/5) APIコール）
  → 5件バッチ。プロンプト:
    「以下のMarkdownファイル群から、内容を表す3〜5個のキーワードを日本語で抽出してください。
     JSON形式で返してください: [{"path":"...","keywords":["kw1","kw2"]}]」

Phase 3: グループ化（1 APIコール）
  → 全ファイル+キーワード → 4〜8グループ。プロンプト:
    「キーワードの類似性に基づいてグループ化してください。
     JSON形式で返してください: [{"groupId":"g1","fileIds":["path1","path2"]}]」

Phase 4: 2トップグループへの集約＋ラベリング（1 APIコール）
  → グループ群 → 2つの大グループ + 階層 + 各グループのジャンル名。プロンプト:
    「グループを最終的に2つの大グループになるよう階層化し、各グループに短い日本語のジャンル名を付けてください。
     JSON形式で返してください:
     {"hierarchy":[{"id":"top1","label":"ジャンル名","children":[{"id":"g1","label":"サブジャンル","files":["path"]}]}]}」

Phase 5: GraphData変換
  → nodes（FileGraphNode + GroupGraphNode）とedgesを構築して返却
```

**合計APIコール数：** `ceil(N/5) + 2`（12ファイルなら5回）

---

## フロントエンド実装

### `src/hooks/useGraphAnalysis.ts`

```typescript
export function useGraphAnalysis(vaultPath: string) {
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string>("");

  const analyze = useCallback(async (dirPath: string) => {
    setStatus("analyzing");
    try {
      const result = await invoke<GraphData>("analyze_vault_for_graph", { dirPath });
      setData(result);
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setData(null);
    setError("");
  }, []);

  return { status, data, error, analyze, reset };
}
```

### `src/components/GraphPanel.tsx` のUI構造

```
GraphPanel (幅: 400px デフォルト、200px〜 可変)
├── リサイズハンドル（GitPanel と同じ mousedown パターン、左辺ドラッグ）
├── ヘッダー
│   ├── "Graph" タイトル
│   ├── 解析ディレクトリパス（vaultPath）
│   └── ボタン: [分析開始] [リセット]
├── 進捗・エラー表示
│   ├── status === "analyzing" → スピナー + "解析中..."
│   └── status === "error" → エラーメッセージ
└── Cytoscapeコンテナ（status === "done"）
    ├── ファイルノード: 小円 15px
    ├── 中間グループノード: 中円 30px
    ├── トップグループノード: 大円 50px（2個）
    ├── エッジ: 矢印なし線
    └── div.graph-tooltip（ホバー時に表示）
```

### Cytoscapeノードスタイル

```javascript
{
  selector: 'node[type="file"]',
  style: { width: 15, height: 15, backgroundColor: 'var(--fg-muted)' }
},
{
  selector: 'node[type="group"][level=1]',
  style: { width: 30, height: 30, backgroundColor: 'var(--accent)' }
},
{
  selector: 'node[type="group"][level=2]',
  style: { width: 50, height: 50, backgroundColor: 'var(--accent)', label: 'data(label)' }
},
```

### イベントハンドラ

```javascript
// ホバー: ファイルノードにのみtoolip表示
cy.on('mouseover', 'node[type="file"]', (e) => {
  showTooltip(e.target.data('label'), e.renderedPosition());
});
cy.on('mouseout', 'node', () => hideTooltip());

// クリック: ファイルノードをエディタで開く
cy.on('tap', 'node[type="file"]', (e) => {
  onOpenFile(e.target.data('path'));
});
```

---

## App.tsx 統合（最小変更）

```typescript
// 追加state（1行）
const [graphOpen, setGraphOpen] = useState(false);

// ヘッダーボタン追加（1要素）
<button className={`header-btn ${graphOpen ? 'active' : ''}`}
  onClick={() => setGraphOpen(v => !v)} title="Graph">◈</button>

// app-body内にGraphPanel追加
{graphOpen && (
  <GraphPanel
    vaultPath={vaultPath}
    onOpenFile={handleSelectFile}
  />
)}
```

---

## 依存関係追加

### Rust（`Cargo.toml`）

```toml
[dependencies]
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
jsonwebtoken = "9"
base64 = "0.22"
```

### npm

```bash
npm install cytoscape cytoscape-dagre
npm install --save-dev @types/cytoscape @types/cytoscape-dagre
```

---

## 実装順序

1. `Cargo.toml` に reqwest, jsonwebtoken, base64 追加
2. `config.rs` の `AiConfig` に `vertex_ai_*` フィールド4つ追加
3. `src-tauri/src/vertex_ai.rs` 作成（JWT認証 + Gemini API呼び出し）
4. `commands.rs` に `analyze_vault_for_graph` 追加
5. `lib.rs` にコマンド登録
6. `cargo build` で確認
7. npm で cytoscape, cytoscape-dagre 追加
8. `src/types/index.ts` にグラフ型追加
9. `useGraphAnalysis.ts` 作成
10. `GraphPanel.tsx` 作成
11. `App.tsx` に統合
12. `App.css` にスタイル追加
13. 動作確認

---

## 検証方法

1. `bun tauri dev` でアプリ起動
2. `~/.config/nomos/config.toml` に `vertex_ai_*` 設定を追加
3. ヘッダーの ◈ ボタンでGraphパネルを開く
4. 「分析開始」でvault内 .md ファイルを解析
5. ネットワークグラフが描画されることを確認：
   - ファイルノード（小円）→ グループノード（中円）→ トップグループ（大円 × 2）
   - 各グループに日本語ジャンルラベルが付いている
6. ファイルノードにホバー → ファイル名tooltipが表示される
7. ファイルノードをクリック → エディタにファイルが開く
8. パネル左辺をドラッグ → 幅が変わる
