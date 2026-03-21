import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 28;
const DEFAULT_FONT_SIZE = 13;

const FONT_OPTIONS = [
  { label: "JetBrains Mono", value: "'JetBrains Mono', monospace" },
  { label: "Fira Code",      value: "'Fira Code', monospace" },
  { label: "Cascadia Code",  value: "'Cascadia Code', monospace" },
  { label: "Menlo",          value: "Menlo, monospace" },
  { label: "Monaco",         value: "Monaco, monospace" },
  { label: "Consolas",       value: "Consolas, monospace" },
  { label: "Courier New",    value: "'Courier New', monospace" },
  { label: "システムモノ",    value: "ui-monospace, monospace" },
];

interface TerminalPanelProps {
  isOpen: boolean;
  height: number;
  vaultPath: string;
  onResizeStart: (e: React.MouseEvent) => void;
}

export function TerminalPanel({ isOpen, height, vaultPath, onResizeStart }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE);
  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0].value);

  const applyFontSize = useCallback((next: number) => {
    const clamped = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, next));
    setFontSize(clamped);
    if (termRef.current) {
      termRef.current.options.fontSize = clamped;
      requestAnimationFrame(() => fitAddonRef.current?.fit());
    }
  }, []);

  const applyFontFamily = useCallback((value: string) => {
    setFontFamily(value);
    if (termRef.current) {
      termRef.current.options.fontFamily = value;
      requestAnimationFrame(() => fitAddonRef.current?.fit());
    }
  }, []);

  // 初回オープン時にターミナルを初期化
  useEffect(() => {
    if (!isOpen || initializedRef.current || !containerRef.current) return;
    initializedRef.current = true;

    const term = new Terminal({
      theme: {
        background: "#1a1b1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
        selectionBackground: "rgba(77, 158, 245, 0.3)",
        black: "#1a1b1e",
        red: "#e05252",
        green: "#7ec683",
        yellow: "#e8b44a",
        blue: "#4d9ef5",
        magenta: "#b57fde",
        cyan: "#5fc0c0",
        white: "#d4d4d4",
        brightBlack: "#555555",
        brightRed: "#ff6666",
        brightGreen: "#8fe694",
        brightYellow: "#ffc86b",
        brightBlue: "#79b8ff",
        brightMagenta: "#d8a8ff",
        brightCyan: "#87d3d3",
        brightWhite: "#ffffff",
      },
      fontFamily,
      fontSize: DEFAULT_FONT_SIZE,
      lineHeight: 1.4,
      cursorBlink: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current!);
    termRef.current = term;

    requestAnimationFrame(() => {
      fitAddon.fit();
      fitAddonRef.current = fitAddon;
      invoke("terminal_create", { rows: term.rows, cols: term.cols, cwd: vaultPath || null }).catch(console.error);
    });

    let unlisten: (() => void) | null = null;
    listen<string>("terminal-output", (event) => {
      const raw = atob(event.payload);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      term.write(bytes);
    }).then((fn) => { unlisten = fn; });

    term.onData((data) => {
      invoke("terminal_write", { data }).catch(console.error);
    });

    term.onResize(({ rows, cols }) => {
      invoke("terminal_resize", { rows, cols }).catch(console.error);
    });

    return () => {
      unlisten?.();
      term.dispose();
      termRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // パネルサイズ変更時にフィット
  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => fitAddonRef.current?.fit());
  }, [isOpen, height]);

  // Ctrl+ホイールでフォントサイズ変更
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setFontSize((prev) => {
      const next = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, prev + (e.deltaY < 0 ? 1 : -1)));
      if (termRef.current) {
        termRef.current.options.fontSize = next;
        requestAnimationFrame(() => fitAddonRef.current?.fit());
      }
      return next;
    });
  }, []);

  return (
    <div
      className="terminal-panel"
      style={isOpen ? { height } : { height: 0 }}
      onWheel={handleWheel}
    >
      <div className="terminal-resize-handle" onMouseDown={onResizeStart} />
      <div className="terminal-panel-header">
        <span className="terminal-panel-title">ターミナル</span>
        <div className="terminal-font-controls">
          <select
            className="terminal-font-select"
            value={fontFamily}
            onChange={(e) => applyFontFamily(e.target.value)}
            title="フォントファミリー"
          >
            {FONT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button
            className="terminal-font-btn"
            onClick={() => applyFontSize(fontSize - 1)}
            title="フォントサイズを小さく"
            disabled={fontSize <= MIN_FONT_SIZE}
          >A−</button>
          <span className="terminal-font-size">{fontSize}</span>
          <button
            className="terminal-font-btn"
            onClick={() => applyFontSize(fontSize + 1)}
            title="フォントサイズを大きく"
            disabled={fontSize >= MAX_FONT_SIZE}
          >A+</button>
          <button
            className="terminal-font-btn"
            onClick={() => applyFontSize(DEFAULT_FONT_SIZE)}
            title="フォントサイズをリセット"
          >↺</button>
        </div>
      </div>
      <div className="terminal-content" ref={containerRef} />
    </div>
  );
}
