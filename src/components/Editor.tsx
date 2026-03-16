import { useState, useMemo } from "react";
import { FileViewer, isViewableFile } from "./FileViewer";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { wikilinkPlugin, wikilinkClickHandler } from "../extensions/wikilinks";

type ViewMode = "edit" | "split" | "preview";

interface EditorProps {
  content: string;
  filePath: string | null;
  isDirty: boolean;
  onChange: (value: string) => void;
  onNavigate?: (link: string) => void;
}

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "14px",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    lineHeight: "1.7",
  },
  ".cm-content": {
    padding: "16px 20px",
    maxWidth: "760px",
    margin: "0 auto",
  },
  ".cm-line": {
    padding: "0",
  },
});

const baseExtensions = [
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  editorTheme,
  EditorView.lineWrapping,
  wikilinkPlugin,
];

export function Editor({ content, filePath, isDirty, onChange, onNavigate }: EditorProps) {
  const extensions = useMemo(() => [
    ...baseExtensions,
    ...(onNavigate ? [wikilinkClickHandler(onNavigate)] : []),
  ], [onNavigate]);
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
          <div className="editor-pane">
            <CodeMirror
              value={content}
              height="100%"
              theme={oneDark}
              extensions={extensions}
              onChange={onChange}
              basicSetup={{
                lineNumbers: true,
                highlightActiveLineGutter: true,
                highlightSpecialChars: true,
                history: true,
                foldGutter: false,
                drawSelection: true,
                dropCursor: true,
                allowMultipleSelections: true,
                indentOnInput: true,
                syntaxHighlighting: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: true,
                rectangularSelection: false,
                crosshairCursor: false,
                highlightActiveLine: true,
                highlightSelectionMatches: true,
                closeBracketsKeymap: true,
                defaultKeymap: true,
                searchKeymap: true,
                historyKeymap: true,
                foldKeymap: false,
                completionKeymap: true,
                lintKeymap: true,
              }}
            />
          </div>
        )}

        {(viewMode === "preview" || viewMode === "split") && (
          <div className="preview-pane">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
            >
              {content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
