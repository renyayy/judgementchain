import CodeMirror from "@uiw/react-codemirror";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";

interface EditorProps {
  content: string;
  filePath: string | null;
  isDirty: boolean;
  onChange: (value: string) => void;
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
  // wikilink styling
  ".cm-wikilink": {
    color: "#79b8ff",
    textDecoration: "underline",
    cursor: "pointer",
  },
});

export function Editor({ content, filePath, isDirty, onChange }: EditorProps) {
  const extensions = [
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
    }),
    editorTheme,
    EditorView.lineWrapping,
  ];

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

  return (
    <div className="editor-container">
      <div className="editor-header">
        <span className="editor-filename">
          {filePath.split("/").pop()}
          {isDirty && <span className="editor-dirty-indicator">●</span>}
        </span>
      </div>
      <div className="editor-body">
        <CodeMirror
          value={content}
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
    </div>
  );
}
