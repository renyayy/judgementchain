import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import { useGraphAnalysis } from "../hooks/useGraphAnalysis";
import type { GraphData } from "../types";

cytoscape.use(dagre);

function getTotalLevels(graphData: GraphData): number {
  for (const node of graphData.nodes) {
    for (const kw of node.keywords) {
      if (kw.startsWith("total_levels:")) return parseInt(kw.split(":")[1], 10);
    }
  }
  return Math.max(...graphData.nodes.map(n => n.level), 1);
}

function filterByMode(
  graphData: GraphData,
  mode: "hierarchy" | "graph",
  floor: number | null,
): GraphData {
  if (mode === "hierarchy") {
    return {
      nodes: graphData.nodes,
      edges: graphData.edges.filter(e => e.edge_type === "hierarchy"),
    };
  }
  // グラフモード: 選択フロアのノードのみ + similarityエッジのみ
  if (floor === null) return { nodes: [], edges: [] };
  const nodes = graphData.nodes.filter(n => n.level === floor);
  const nodeIds = new Set(nodes.map(n => n.id));
  const edges = graphData.edges.filter(e =>
    e.edge_type === "similarity" && nodeIds.has(e.source) && nodeIds.has(e.target)
  );
  return { nodes, edges };
}

interface GraphPanelProps {
  vaultPath: string;
  onOpenFile: (path: string) => void;
}

interface TooltipState {
  visible: boolean;
  text: string;
  x: number;
  y: number;
}

interface VertexSettings {
  service_account_json: string;
  project_id: string;
  location: string;
  model: string;
}

export default function GraphPanel({ vaultPath, onOpenFile }: GraphPanelProps) {
  const { status, data, error, analyze, reset } = useGraphAnalysis();
  const cyRef = useRef<HTMLDivElement>(null);
  const cyInstance = useRef<cytoscape.Core | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState>({ visible: false, text: "", x: 0, y: 0 });

  // 表示モード・フロア選択
  const [viewMode, setViewMode] = useState<"hierarchy" | "graph">("hierarchy");
  const [selectedFloor, setSelectedFloor] = useState<number | null>(null);
  const [totalLevels, setTotalLevels] = useState(0);

  // 設定パネル
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<VertexSettings>({
    service_account_json: "",
    project_id: "",
    location: "us-central1",
    model: "gemini-2.0-flash-001",
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [graphBackend, setGraphBackend] = useState("claude");

  // マウント時に設定を読み込む
  useEffect(() => {
    invoke<Record<string, unknown>>("get_config").then((cfg) => {
      const ai = cfg.ai as Record<string, string> | undefined;
      if (ai) {
        setSettings({
          service_account_json: ai.vertex_ai_service_account_json ?? "",
          project_id: ai.vertex_ai_project_id ?? "",
          location: ai.vertex_ai_location ?? "us-central1",
          model: ai.vertex_ai_model ?? "gemini-2.0-flash-001",
        });
        setGraphBackend(ai.graph_backend ?? "claude");
      }
    });
  }, []);

  const handleSaveConfig = useCallback(async () => {
    setSavingConfig(true);
    setSaveMsg("");
    try {
      const cfg = await invoke<Record<string, unknown>>("get_config");
      const ai = (cfg.ai as Record<string, string>) ?? {};
      const updated = {
        ...cfg,
        ai: {
          ...ai,
          vertex_ai_service_account_json: settings.service_account_json,
          vertex_ai_project_id: settings.project_id,
          vertex_ai_location: settings.location,
          vertex_ai_model: settings.model,
        },
      };
      await invoke("update_config", { config: updated });
      setSaveMsg("保存しました");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e) {
      setSaveMsg(`エラー: ${String(e)}`);
    } finally {
      setSavingConfig(false);
    }
  }, [settings]);

  // Cytoscapeグラフの初期化・更新
  const buildGraph = useCallback((graphData: GraphData) => {
    if (!cyRef.current) return;

    if (cyInstance.current) {
      cyInstance.current.destroy();
    }

    const elements: cytoscape.ElementDefinition[] = [
      ...graphData.nodes.map((node) => ({
        data: {
          id: node.id,
          label: node.label,
          type: node.type,
          path: node.type === "file" ? node.id : undefined,
          keywords: node.keywords.join(", "),
          level: node.level,
        },
      })),
      ...graphData.edges.map((edge) => ({
        data: {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          edge_type: edge.edge_type,
          weight: edge.weight ?? 0,
        },
      })),
    ];

    const cy = cytoscape({
      container: cyRef.current,
      elements,
      style: [
        {
          selector: 'node[type="file"]',
          style: {
            width: 14,
            height: 14,
            "background-color": "var(--fg-muted, #8b949e)",
            "border-width": 0,
            label: "",
            "text-valign": "bottom",
            "text-halign": "center",
            "font-size": "9px",
            color: "var(--fg, #e6edf3)",
          },
        },
        // 動的グループノードスタイル（レベル数に応じてスケール）
        ...Array.from({ length: Math.max(totalLevels - 1, 2) }, (_, i) => {
          const lvl = i + 2;
          const maxLvl = Math.max(totalLevels, 3);
          const t = (lvl - 1) / Math.max(maxLvl - 1, 1);
          const size = 20 + t * 40;
          const fontSize = 9 + t * 3;
          return {
            selector: `node[type="group"][level=${lvl}]`,
            style: {
              width: size,
              height: size,
              "background-color": t > 0.5 ? "var(--accent-emphasis, #1f6feb)" : "var(--accent, #58a6ff)",
              "border-width": t > 0.5 ? 2 : 0,
              "border-color": "var(--accent, #58a6ff)",
              label: "data(label)",
              "text-valign": "bottom" as const,
              "text-halign": "center" as const,
              "font-size": `${fontSize}px`,
              "font-weight": (t > 0.7 ? "bold" : "normal") as cytoscape.Css.FontWeight,
              color: "var(--fg, #e6edf3)",
              "text-wrap": "wrap" as const,
              "text-max-width": `${70 + t * 40}px`,
            },
          };
        }),
        {
          selector: 'edge[edge_type="hierarchy"]',
          style: {
            width: 1,
            "line-color": "var(--border, #30363d)",
            "target-arrow-shape": "none",
            "curve-style": "bezier",
            opacity: 0.7,
          },
        },
        {
          selector: 'edge[edge_type="similarity"]',
          style: {
            width: "mapData(weight, 0.5, 1, 1, 4)" as unknown as number,
            "line-color": "var(--accent, #58a6ff)",
            "target-arrow-shape": "none" as const,
            "curve-style": "bezier" as const,
            opacity: "mapData(weight, 0.5, 1, 0.3, 0.8)" as unknown as number,
          },
        },
        {
          selector: "node:selected",
          style: {
            "border-width": 2,
            "border-color": "var(--accent, #58a6ff)",
          },
        },
      ],
      layout: (viewMode === "graph" ? {
        name: "cose",
        padding: 30,
        nodeRepulsion: () => 8000,
        idealEdgeLength: () => 80,
        animate: false,
      } : {
        name: "dagre",
        rankDir: "BT",
        nodeSep: 20,
        rankSep: 60,
        padding: 20,
      }) as cytoscape.LayoutOptions,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      minZoom: 0.2,
      maxZoom: 3,
    });

    cy.on("mouseover", 'node[type="file"]', (e) => {
      const renderedPos = e.target.renderedPosition();
      const containerRect = cyRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      setTooltip({
        visible: true,
        text: e.target.data("label"),
        x: containerRect.left + renderedPos.x,
        y: containerRect.top + renderedPos.y - 24,
      });
    });

    cy.on("mouseout", "node", () => {
      setTooltip((t) => ({ ...t, visible: false }));
    });

    cy.on("mouseover", 'node[type="group"]', (e) => {
      const renderedPos = e.target.renderedPosition();
      const containerRect = cyRef.current?.getBoundingClientRect();
      if (!containerRect) return;
      setTooltip({
        visible: true,
        text: e.target.data("label"),
        x: containerRect.left + renderedPos.x,
        y: containerRect.top + renderedPos.y - 36,
      });
    });

    cy.on("tap", 'node[type="file"]', (e) => {
      const path = e.target.data("path");
      if (path) onOpenFile(path);
    });

    cyInstance.current = cy;
  }, [onOpenFile, viewMode]);

  useEffect(() => {
    if (status === "done" && data) {
      const levels = getTotalLevels(data);
      setTotalLevels(levels);
      const filtered = filterByMode(data, viewMode, selectedFloor);
      if (filtered.nodes.length === 0) return;
      buildGraph(filtered);
    }
    return () => {
      if (status !== "done") {
        cyInstance.current?.destroy();
        cyInstance.current = null;
      }
    };
  }, [status, data, viewMode, selectedFloor, buildGraph]);

  useEffect(() => {
    return () => {
      cyInstance.current?.destroy();
    };
  }, []);

  const dirName = vaultPath.split("/").filter(Boolean).pop() ?? vaultPath;

  return (
    <div className="graph-panel">
      <div className="graph-panel-header">
        <span className="graph-panel-title">Graph</span>
        <span className="graph-panel-dir" title={vaultPath}>📁 {dirName}</span>
        <div className="graph-panel-actions">
          <button
            className={`graph-btn ${settingsOpen ? "active" : ""}`}
            onClick={() => setSettingsOpen((v) => !v)}
            title="設定"
          >
            ⚙
          </button>
          {status !== "analyzing" && (
            <button
              className="graph-btn"
              onClick={() => analyze(vaultPath)}
              disabled={!vaultPath}
              title="解析開始"
            >
              分析
            </button>
          )}
          {status !== "idle" && (
            <button className="graph-btn" onClick={reset} title="リセット">
              ✕
            </button>
          )}
        </div>
      </div>

      {settingsOpen && (
        <div className="graph-settings">
          <div className="graph-settings-title">Vertex AI 設定</div>
          <label className="graph-settings-label">
            サービスアカウントJSON
            <textarea
              className="graph-settings-input graph-settings-textarea"
              placeholder={'{\n  "type": "service_account",\n  "project_id": "...",\n  ...\n}'}
              value={settings.service_account_json}
              onChange={(e) => setSettings((s) => ({ ...s, service_account_json: e.target.value }))}
              spellCheck={false}
            />
          </label>
          <label className="graph-settings-label">
            GCPプロジェクトID
            <input
              className="graph-settings-input"
              type="text"
              placeholder="my-gcp-project"
              value={settings.project_id}
              onChange={(e) => setSettings((s) => ({ ...s, project_id: e.target.value }))}
            />
          </label>
          <label className="graph-settings-label">
            リージョン
            <input
              className="graph-settings-input"
              type="text"
              placeholder="us-central1"
              value={settings.location}
              onChange={(e) => setSettings((s) => ({ ...s, location: e.target.value }))}
            />
          </label>
          <label className="graph-settings-label">
            モデル
            <input
              className="graph-settings-input"
              type="text"
              placeholder="gemini-2.0-flash-001"
              value={settings.model}
              onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
            />
          </label>
          <div className="graph-settings-footer">
            {saveMsg && <span className="graph-save-msg">{saveMsg}</span>}
            <button
              className="graph-btn"
              onClick={handleSaveConfig}
              disabled={savingConfig}
            >
              {savingConfig ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      )}

      <div className="graph-panel-body">
        {status === "idle" && (
          <div className="graph-empty">
            <p>「分析」ボタンを押すと、vault内の.mdファイルを解析してネットワーク図を表示します。</p>
            {false && !settings.project_id && (
              <p className="graph-empty-warn">⚙ ボタンからVertex AI設定を行ってください。</p>
            )}
          </div>
        )}

        {status === "analyzing" && (
          <div className="graph-progress">
            <div className="graph-spinner" />
            <span>{graphBackend === "vertex_ai" ? "Vertex AI (Gemini)" : graphBackend === "claude" ? "Claude" : graphBackend} で解析中...</span>
            <p className="graph-progress-note">キーワード抽出 → グルーピング → 階層化</p>
          </div>
        )}

        {status === "error" && (
          <div className="graph-error">
            <p>⚠ エラーが発生しました</p>
            <pre>{error}</pre>
          </div>
        )}

        {status === "done" && totalLevels > 1 && (
          <div className="graph-floor-selector">
            <div className="graph-mode-selector">
              <button
                className={`graph-floor-btn ${viewMode === "hierarchy" ? "active" : ""}`}
                onClick={() => { setViewMode("hierarchy"); setSelectedFloor(null); }}
              >
                階層
              </button>
              <button
                className={`graph-floor-btn ${viewMode === "graph" ? "active" : ""}`}
                onClick={() => { setViewMode("graph"); if (selectedFloor === null) setSelectedFloor(1); }}
              >
                グラフ
              </button>
            </div>
            {viewMode === "graph" && (
              <>
                <span className="graph-floor-separator">|</span>
                {Array.from({ length: totalLevels }, (_, i) => i + 1).map(floor => (
                  <button
                    key={floor}
                    className={`graph-floor-btn ${selectedFloor === floor ? "active" : ""}`}
                    onClick={() => setSelectedFloor(floor)}
                  >
                    F{floor}
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        <div
          ref={cyRef}
          className="graph-canvas"
          style={{ display: status === "done" ? "block" : "none" }}
        />
      </div>

      {tooltip.visible && (
        <div
          className="graph-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
