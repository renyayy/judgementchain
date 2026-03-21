import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import cytoscape from "cytoscape";
import dagre from "cytoscape-dagre";
import { useGraphAnalysis } from "../hooks/useGraphAnalysis";
import type { GraphData } from "../types";

cytoscape.use(dagre);

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

  // リサイズ
  const [width, setWidth] = useState(420);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(420);

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

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.classList.add("resizing");
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      setWidth(Math.max(200, Math.min(700, startWidth.current - (e.clientX - startX.current))));
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.body.classList.remove("resizing");
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

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
        {
          selector: 'node[type="group"][level=2]',
          style: {
            width: 30,
            height: 30,
            "background-color": "var(--accent, #58a6ff)",
            "border-width": 0,
            label: "data(label)",
            "text-valign": "bottom",
            "text-halign": "center",
            "font-size": "9px",
            color: "var(--fg, #e6edf3)",
            "text-wrap": "wrap",
            "text-max-width": "80px",
          },
        },
        {
          selector: 'node[type="group"][level=3]',
          style: {
            width: 52,
            height: 52,
            "background-color": "var(--accent-emphasis, #1f6feb)",
            "border-width": 2,
            "border-color": "var(--accent, #58a6ff)",
            label: "data(label)",
            "text-valign": "bottom",
            "text-halign": "center",
            "font-size": "11px",
            "font-weight": "bold",
            color: "var(--fg, #e6edf3)",
            "text-wrap": "wrap",
            "text-max-width": "100px",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1,
            "line-color": "var(--border, #30363d)",
            "target-arrow-shape": "none",
            "curve-style": "bezier",
            opacity: 0.7,
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
      layout: {
        name: "dagre",
        rankDir: "BT",
        nodeSep: 20,
        rankSep: 60,
        padding: 20,
      } as cytoscape.LayoutOptions,
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
  }, [onOpenFile]);

  useEffect(() => {
    if (status === "done" && data) {
      buildGraph(data);
    }
    return () => {
      if (status !== "done") {
        cyInstance.current?.destroy();
        cyInstance.current = null;
      }
    };
  }, [status, data, buildGraph]);

  useEffect(() => {
    return () => {
      cyInstance.current?.destroy();
    };
  }, []);

  const dirName = vaultPath.split("/").filter(Boolean).pop() ?? vaultPath;

  return (
    <div className="graph-panel" style={{ width }}>
      <div className="margin-panel-resize-handle" onMouseDown={handleResizeStart} />
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
