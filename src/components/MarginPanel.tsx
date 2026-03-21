import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { MarginAnnotation, Backlink } from "../types";

interface MarginPanelProps {
  annotations: MarginAnnotation[];
  backlinks: Backlink[];
  onOpenNote: (path: string) => void;
  onRefreshAnnotations?: () => void;
}

const ICON_MAP: Record<string, string> = {
  related_note: "💡",
  contradiction: "⚡",
  self_contradiction: "🔄",
  paper: "📄",
  summary: "📝",
  link: "🔗",
};

export function MarginPanel({ annotations, backlinks, onOpenNote, onRefreshAnnotations }: MarginPanelProps) {
  const [width, setWidth] = useState(260);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const hasSummary = annotations.some((a) => a.annotation_type === "summary");

  const handleGenerateSummary = async () => {
    setGeneratingSummary(true);
    try {
      await invoke<string>("generate_weekly_summary");
      onRefreshAnnotations?.();
    } catch {
      // モデル未ロードや活動なしの場合は静かに失敗
    } finally {
      setGeneratingSummary(false);
    }
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.classList.add("resizing");

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const next = Math.max(180, Math.min(480, startWidth.current - (e.clientX - startX.current)));
      setWidth(next);
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

  return (
    <aside className="margin-panel" style={{ width, minWidth: width }}>
      <div className="margin-panel-resize-handle" onMouseDown={handleResizeStart} />
      <div className="margin-panel-section">
        <h3 className="margin-section-title">Judgement Brain</h3>

        {annotations.length === 0 && backlinks.length === 0 ? (
          <div className="margin-empty">
            <p>注釈なし</p>
            <p className="margin-empty-hint">ノートを保存すると関連情報が表示されます</p>
          </div>
        ) : null}

        {annotations.length > 0 && (
          <div className="margin-annotations">
            {annotations.map((annotation) => (
              <div
                key={annotation.id}
                className={`margin-card margin-card--${annotation.annotation_type}`}
                onClick={() => annotation.link && onOpenNote(annotation.link)}
                style={{ cursor: annotation.link ? "pointer" : "default" }}
              >
                <div className="margin-card-header">
                  <span className="margin-card-icon">
                    {ICON_MAP[annotation.annotation_type] ?? ICON_MAP[annotation.icon] ?? "💡"}
                  </span>
                  <span className="margin-card-title">{annotation.title}</span>
                </div>
                <p className="margin-card-content">{annotation.content}</p>
              </div>
            ))}
          </div>
        )}

        {!hasSummary && (
          <button
            className="margin-generate-summary-btn"
            onClick={handleGenerateSummary}
            disabled={generatingSummary}
          >
            {generatingSummary ? "生成中..." : "📊 週次サマリを生成"}
          </button>
        )}
      </div>

      {backlinks.length > 0 && (
        <div className="margin-panel-section">
          <h3 className="margin-section-title">バックリンク</h3>
          <div className="backlinks-list">
            {backlinks.map((bl, i) => (
              <div
                key={i}
                className="backlink-item"
                onClick={() => onOpenNote(bl.source)}
              >
                🔗 {bl.source.split("/").pop()}
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
