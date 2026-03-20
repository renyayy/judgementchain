import { createTheme } from "@uiw/codemirror-themes";
import { tags } from "@lezer/highlight";

const headingStyles = [
  { tag: tags.heading1, color: "#e05252", fontWeight: "bold" as const },
  { tag: tags.heading2, color: "#e89a3c", fontWeight: "bold" as const },
  { tag: tags.heading3, color: "#d4b84b", fontWeight: "bold" as const },
];

export const nomosDark = createTheme({
  theme: "dark",
  settings: {
    background: "#1a1b1e",
    foreground: "#d4d4d4",
    caret: "#4d9ef5",
    selection: "#2d4a7a",
    selectionMatch: "#2d4a7a55",
    gutterBackground: "#222327",
    gutterForeground: "#555",
    gutterBorder: "#3a3b3f",
    lineHighlight: "#2a2b2f55",
  },
  styles: [
    ...headingStyles,
    { tag: tags.link, color: "#79b8ff" },
    { tag: tags.url, color: "#79b8ff" },
    { tag: tags.emphasis, fontStyle: "italic" as const },
    { tag: tags.strong, fontWeight: "bold" as const },
    { tag: [tags.keyword, tags.operator], color: "#c678dd" },
    { tag: [tags.string, tags.meta], color: "#98c379" },
    { tag: tags.comment, color: "#5c6370", fontStyle: "italic" as const },
  ],
});

export const nomosLight = createTheme({
  theme: "light",
  settings: {
    background: "#f0f0f0",
    foreground: "#1e1e1e",
    caret: "#0078d4",
    selection: "#c8ddf5",
    selectionMatch: "#c8ddf555",
    gutterBackground: "#e8e8e8",
    gutterForeground: "#999",
    gutterBorder: "#d0d0d0",
    lineHighlight: "#dcdcdc55",
  },
  styles: [
    ...headingStyles,
    { tag: tags.link, color: "#0078d4" },
    { tag: tags.url, color: "#0078d4" },
    { tag: tags.emphasis, fontStyle: "italic" as const },
    { tag: tags.strong, fontWeight: "bold" as const },
    { tag: [tags.keyword, tags.operator], color: "#7c3aed" },
    { tag: [tags.string, tags.meta], color: "#16a34a" },
    { tag: tags.comment, color: "#a0a0a0", fontStyle: "italic" as const },
  ],
});
