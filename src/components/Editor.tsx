import { Suspense, lazy, useState } from "react";
import { FileViewer, isViewableFile } from "./FileViewer";

const MarkdownCodeEditor = lazy(() =>
  import("./MarkdownCodeEditor").then((m) => ({ default: m.MarkdownCodeEditor })),
);
const MarkdownPreview = lazy(() =>
  import("./MarkdownPreview").then((m) => ({ default: m.MarkdownPreview })),
);

type ViewMode = "edit" | "split" | "preview";

interface EditorProps {
  content: string;
  filePath: string | null;
  isDirty: boolean;
  onChange: (value: string) => void;
  onNavigate?: (link: string) => void;
}

export function Editor({ content, filePath, isDirty, onChange, onNavigate }: EditorProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("edit");

  if (!filePath) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-content">
          <p>ファイルを選択してください</p>
          <p className="editor-empty-hint">左のパネルからノートを選択するか、新規作成してください</p>
        </div>
      </div>
    );
  }

  // 画像・PDF はビューアで表示
  if (isViewableFile(filePath)) {
    return (
      <div className="editor-container">
        <div className="editor-header">
          <span className="editor-filename">{filePath.split("/").pop()}</span>
        </div>
        <div className="editor-body editor-body--preview">
          <FileViewer filePath={filePath} />
        </div>
      </div>
    );
  }

  return (
    <div className="editor-container">
      <div className="editor-header">
        <span className="editor-filename">
          {filePath.split("/").pop()}
          {isDirty && <span className="editor-dirty-indicator">●</span>}
        </span>
        <div className="view-mode-toggle">
          <button
            className={viewMode === "edit" ? "active" : ""}
            onClick={() => setViewMode("edit")}
            title="編集"
          >
            編集
          </button>
          <button
            className={viewMode === "split" ? "active" : ""}
            onClick={() => setViewMode("split")}
            title="分割"
          >
            分割
          </button>
          <button
            className={viewMode === "preview" ? "active" : ""}
            onClick={() => setViewMode("preview")}
            title="プレビュー"
          >
            プレビュー
          </button>
        </div>
      </div>

      <div className={`editor-body editor-body--${viewMode}`}>
        {(viewMode === "edit" || viewMode === "split") && (
          <div className="editor-cm-pane">
            <Suspense fallback={null}>
              <MarkdownCodeEditor value={content} onChange={onChange} onNavigate={onNavigate} />
            </Suspense>
          </div>
        )}

        {(viewMode === "preview" || viewMode === "split") && (
          <div className="preview-pane">
            <Suspense fallback={null}>
              <MarkdownPreview content={content} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
