import { useEffect, useState, useMemo } from "react";
import { FileViewer, isViewableFile } from "./FileViewer";
import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { Extension } from "@codemirror/state";
import "highlight.js/styles/github-dark.css";
import { wikilinkPlugin, wikilinkClickHandler } from "../extensions/wikilinks";
import { wordCompletionExtension } from "../extensions/wordCompletion";
import { MarkdownPreview } from "./MarkdownPreview";

type ViewMode = "edit" | "split" | "preview";

interface EditorProps {
  content: string;
  filePath: string | null;
  isDirty: boolean;
  fontSize?: number;
  theme?: "dark" | "light";
  onChange: (value: string) => void;
  onNavigate?: (link: string) => void;
}

function getFileName(path: string) {
  return path.split("/").pop() ?? path;
}

function isMarkdownFile(path: string) {
  return path.toLowerCase().endsWith(".md");
}

function isAdocFile(path: string) {
  return path.toLowerCase().endsWith(".adoc");
}

export function Editor({ content, filePath, isDirty, fontSize = 14, theme = "dark", onChange, onNavigate }: EditorProps) {
  const editorTheme = useMemo(() => EditorView.theme({
    "&": { height: "100%", fontSize: `${fontSize}px` },
    ".cm-scroller": { overflow: "auto", fontFamily: "'JetBrains Mono', 'Fira Code', monospace", lineHeight: "1.7" },
    ".cm-content": { padding: "16px 20px", maxWidth: "760px", margin: "0 auto" },
    ".cm-line": { padding: "0" },
  }), [fontSize]);

  const sharedExtensions = useMemo(() => [editorTheme, EditorView.lineWrapping], [editorTheme]);

  const [extensions, setExtensions] = useState<Extension[]>(sharedExtensions);
  const [viewMode, setViewMode] = useState<ViewMode>("edit");

  useEffect(() => {
    if (!filePath || !isMarkdownFile(filePath)) {
      setViewMode("edit");
    }
  }, [filePath]);

  useEffect(() => {
    if (!filePath) {
      setExtensions(sharedExtensions);
      return;
    }

    let cancelled = false;

    const buildExtensions = async () => {
      if (isMarkdownFile(filePath)) {
        const markdownExtensions: Extension[] = [
          ...sharedExtensions,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          wikilinkPlugin,
          ...(onNavigate ? [wikilinkClickHandler(onNavigate)] : []),
        ];
        if (!cancelled) setExtensions(markdownExtensions);
        return;
      }

      const completionExtension = isAdocFile(filePath) ? null : wordCompletionExtension(filePath);
      const baseExtensions: Extension[] = completionExtension
        ? [...sharedExtensions, completionExtension]
        : [...sharedExtensions];

      const fileName = getFileName(filePath);
      const description = LanguageDescription.matchFilename(languages, fileName);
      try {
        const loaded = description ? await description.load() : null;
        const languageExtensions: Extension[] = loaded ? [...baseExtensions, loaded] : baseExtensions;
        if (!cancelled) setExtensions(languageExtensions);
      } catch {
        // `@codemirror/lang-*` が未導入の場合などでも、エディタが壊れないようフォールバックする
        if (!cancelled) setExtensions(baseExtensions);
      }
    };

    void buildExtensions();

    return () => {
      cancelled = true;
    };
  }, [filePath, onNavigate, sharedExtensions]);

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
          <span className="editor-filename">{getFileName(filePath)}</span>
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
          {getFileName(filePath)}
          {isDirty && <span className="editor-dirty-indicator">●</span>}
        </span>
        {isMarkdownFile(filePath) && (
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
        )}
      </div>

      <div className={`editor-body editor-body--${viewMode}`}>
        {(viewMode === "edit" || viewMode === "split") && (
          <div className="editor-cm-pane">
            <CodeMirror
              value={content}
              height="100%"
              theme={theme === "light" ? undefined : oneDark}
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

        {isMarkdownFile(filePath) && (viewMode === "preview" || viewMode === "split") && (
          <div className="preview-pane">
            <MarkdownPreview content={content} />
          </div>
        )}
      </div>
    </div>
  );
}
