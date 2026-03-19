import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { wikilinkClickHandler, wikilinkPlugin } from "../extensions/wikilinks";

interface MarkdownCodeEditorProps {
  value: string;
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
  // `@codemirror/language-data` は巨大になりやすいので、
  // Markdown のフェンス内言語は個別追加が必要になった時点で絞って入れる。
  markdown({ base: markdownLanguage }),
  editorTheme,
  EditorView.lineWrapping,
  wikilinkPlugin,
];

export function MarkdownCodeEditor({ value, onChange, onNavigate }: MarkdownCodeEditorProps) {
  const extensions = useMemo(
    () => [...baseExtensions, ...(onNavigate ? [wikilinkClickHandler(onNavigate)] : [])],
    [onNavigate],
  );

  return (
    <CodeMirror
      value={value}
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
  );
}

