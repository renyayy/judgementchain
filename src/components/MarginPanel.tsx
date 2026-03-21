import type { MarginAnnotation, Backlink } from "../types";

interface MarginPanelProps {
  annotations: MarginAnnotation[];
  backlinks: Backlink[];
  onOpenNote: (path: string) => void;
}

const ICON_MAP: Record<string, string> = {
  related_note: "💡",
  contradiction: "⚡",
  paper: "📄",
  summary: "📝",
  link: "🔗",
};

export function MarginPanel({ annotations, backlinks, onOpenNote }: MarginPanelProps) {
  return (
    <aside className="margin-panel">
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
