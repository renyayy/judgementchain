function countWords(text) {
  if (!text) return 0;
  const matches = text.match(/[A-Za-z0-9_]+/g);
  if (matches) return matches.length;
  // それ以外（空白なし日本語など）は、ざっくり「文字列が存在するなら 1」とする
  return text.trim().length > 0 ? 1 : 0;
}

function countCharsIncludeWhitespace(text) {
  return (text ?? "").length;
}

function countCharsExcludeWhitespace(text) {
  const s = (text ?? "").replace(/[ \t\r\n]+/g, "");
  return s.length;
}

const STORAGE_KEY = "nomos.plugin.word-counter.mode";
const MODES = ["words", "chars_include_ws", "chars_exclude_ws"];

function loadMode() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return "chars_include_ws";
    if (MODES.includes(raw)) return raw;
    return "chars_include_ws";
  } catch {
    return "chars_include_ws";
  }
}

function saveMode(mode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

function compute(mode, text) {
  if (mode === "words") return { label: "Words", value: countWords(text) };
  if (mode === "chars_exclude_ws") return { label: "Chars(no-space)", value: countCharsExcludeWhitespace(text) };
  return { label: "Chars", value: countCharsIncludeWhitespace(text) };
}

export default function init(api) {
  let mode = loadMode();
  let lastText = "";
  let containerEl = null;

  const render = () => {
    if (!containerEl) return;
    const { label, value: n } = compute(mode, lastText);
    containerEl.textContent = `${label}: ${n}`;
  };

  api.registerCommand("word-counter.setMode", {
    name: "Word Counter: Set Mode (Words/Chars)",
    callback: () => {
      // クリック1回で次のモードに切り替える
      const idx = MODES.indexOf(mode);
      mode = MODES[(idx + 1) % MODES.length];
      saveMode(mode);
      render();
    },
  });

  api.registerStatusBarItem({
    id: "word-counter",
    render(container) {
      containerEl = container;
      containerEl.textContent = "Chars: 0";

      // 初期値（ファイルを開いたタイミングで file-open が来るまでの暫定表示）
      render();

      const handlerEditorChange = (_path, value) => {
        lastText = value ?? "";
        render();
      };

      const handlerFileOpen = async (path) => {
        try {
          lastText = await api.vault.read(path);
          render();
        } catch {
          // ignore
        }
      };

      api.on("editor-change", handlerEditorChange);
      api.on("file-open", handlerFileOpen);

      return () => {
        api.off("editor-change", handlerEditorChange);
        api.off("file-open", handlerFileOpen);
      };
    },
  });
}

