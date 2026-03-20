import { Extension } from "@codemirror/state";
import { autocompletion, type Completion, type CompletionContext } from "@codemirror/autocomplete";

function getExt(filePath: string) {
  const fileName = filePath.split("/").pop() ?? filePath;
  const idx = fileName.lastIndexOf(".");
  return idx >= 0 ? fileName.slice(idx + 1).toLowerCase() : "";
}

const KEYWORDS_BY_EXT: Record<string, readonly string[]> = {
  ts: [
    "any",
    "unknown",
    "never",
    "boolean",
    "number",
    "string",
    "object",
    "void",
    "null",
    "undefined",
    "symbol",
    "bigint",
    "type",
    "interface",
    "implements",
    "extends",
    "as",
    "asserts",
    "readonly",
    "abstract",
    "declare",
    "enum",
    "namespace",
    "module",
    "public",
    "private",
    "protected",
    "override",
    "static",
    "keyof",
    "typeof",
    "infer",
    "is",
    "get",
    "set",
    "async",
    "await",
    "function",
    "class",
    "return",
    "import",
    "from",
    "export",
    "default",
    "const",
    "let",
    "var",
    "new",
    "try",
    "catch",
    "finally",
    "throw",
    "switch",
    "case",
    "break",
    "continue",
    "if",
    "else",
    "for",
    "while",
    "do",
    "in",
    "instanceof",
    "of",
  ],
  tsx: [],
  js: [
    "async",
    "await",
    "function",
    "class",
    "return",
    "import",
    "from",
    "export",
    "default",
    "const",
    "let",
    "var",
    "new",
    "try",
    "catch",
    "finally",
    "throw",
    "switch",
    "case",
    "break",
    "continue",
    "if",
    "else",
    "for",
    "while",
    "do",
    "in",
    "instanceof",
    "of",
  ],
  jsx: [],
  rb: [
    "class",
    "module",
    "def",
    "end",
    "if",
    "elsif",
    "else",
    "unless",
    "begin",
    "rescue",
    "ensure",
    "case",
    "when",
    "for",
    "while",
    "until",
    "break",
    "next",
    "redo",
    "retry",
    "super",
    "self",
    "yield",
    "true",
    "false",
    "nil",
  ],
  py: [
    "def",
    "class",
    "import",
    "from",
    "as",
    "return",
    "yield",
    "if",
    "elif",
    "else",
    "for",
    "while",
    "break",
    "continue",
    "try",
    "except",
    "finally",
    "raise",
    "with",
    "lambda",
    "True",
    "False",
    "None",
  ],
};

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

function computeBufferWords(doc: string) {
  // 大きなドキュメントでも固まりにくいよう、上限を設ける
  const MAX_CHARS = 250_000;
  const limited = doc.length > MAX_CHARS ? doc.slice(0, MAX_CHARS) : doc;

  const MAX_UNIQUE = 600;
  const MIN_LEN = 2;

  const counts = new Map<string, number>();
  let m: RegExpExecArray | null;
  IDENT_RE.lastIndex = 0;
  while ((m = IDENT_RE.exec(limited))) {
    const word = m[0];
    if (word.length < MIN_LEN) continue;
    const prev = counts.get(word) ?? 0;
    counts.set(word, prev + 1);
    if (counts.size > MAX_UNIQUE) break;
  }

  const stopWords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "have",
    "you",
    "are",
    "not",
    "but",
    "all",
    "any",
    "can",
  ]);

  return Array.from(counts.entries())
    .filter(([w]) => !stopWords.has(w.toLowerCase()))
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w);
}

function getKeywordsForFile(filePath: string) {
  const ext = getExt(filePath);
  const base = KEYWORDS_BY_EXT[ext] ?? [];
  // tsx/jsx は ts/js と同等に扱う
  if (ext === "tsx") return KEYWORDS_BY_EXT.ts;
  if (ext === "jsx") return KEYWORDS_BY_EXT.js;
  return base;
}

function toCompletionOptions(
  words: readonly string[],
  type: Completion["type"],
  sectionName: string,
  sectionRank: number,
): Completion[] {
  return words.map((w) => ({
    label: w,
    type,
    section: { name: sectionName, rank: sectionRank },
  }));
}

export function wordCompletionExtension(filePath: string): Extension {
  const keywords = getKeywordsForFile(filePath);

  const source = (context: CompletionContext) => {
    const token = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*$/);
    if (!token && !context.explicit) return null;

    const query = token?.text ?? "";
    const queryLower = query.toLowerCase();
    const from = token?.from ?? context.pos;
    const to = token?.to ?? context.pos;

    const docText = context.state.doc.toString();
    const bufferWords = computeBufferWords(docText);

    const keywordFiltered = keywords
      .filter((w) => (queryLower ? w.toLowerCase().startsWith(queryLower) : true))
      .slice(0, 60);

    const bufferFiltered: string[] = [];
    const keywordSet = new Set(keywordFiltered);
    for (const w of bufferWords) {
      if (keywordSet.has(w)) continue;
      if (queryLower && !w.toLowerCase().startsWith(queryLower)) continue;
      bufferFiltered.push(w);
      if (bufferFiltered.length >= 60) break;
    }

    const options: Completion[] = [
      ...toCompletionOptions(keywordFiltered, "keyword", "キーワード", 0),
      ...toCompletionOptions(bufferFiltered, "variable", "バッファ語", 1),
    ];

    // トークンがない状態で明示的に開いた場合でも、空prefixで最初の候補を出す
    if (!options.length) return null;

    const validFor = queryLower
      ? (text: string) => text.toLowerCase().startsWith(queryLower)
      : undefined;

    return {
      from,
      to,
      options,
      validFor,
    };
  };

  // override はこのサジェストだけを使うための指定（言語側の補完が無くても動く）
  return [
    autocompletion({
      activateOnTyping: true,
      activateOnTypingDelay: 120,
      override: [source],
      closeOnBlur: true,
    }),
  ] as Extension[];
}

