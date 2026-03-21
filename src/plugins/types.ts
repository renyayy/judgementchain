import type { Extension } from "@codemirror/state";
import type { Decoration, EditorView, ViewPlugin, MatchDecorator } from "@codemirror/view";

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  main: string; // e.g. "main.js"
  capabilities?: string[];
  enabled?: boolean;
}

export type PluginLoadStatus = "loaded" | "error" | "skipped";

export interface PluginState {
  manifest: PluginManifest;
  enabled: boolean;
  status: PluginLoadStatus;
  error?: string;
}

export interface PluginPanelRegistration {
  id: string;
  icon: string;
  title: string;
  render: (container: HTMLElement) => void | (() => void);
}

export interface PluginCommandRegistration {
  id: string;
  name: string;
  shortcut?: string;
  callback: () => void | Promise<void>;
}

export interface PluginStatusBarItemRegistration {
  id: string;
  render: (container: HTMLElement) => void | (() => void);
}

export type PluginEvent = "file-open" | "file-save" | "editor-change";

export interface PluginVaultAPI {
  read: (path: string) => Promise<string>;
  list: (dir?: string) => Promise<string[]>;
}

export interface PluginCodemirrorAPI {
  EditorView: typeof EditorView;
  ViewPlugin: typeof ViewPlugin;
  Decoration: typeof Decoration;
  MatchDecorator: typeof MatchDecorator;
}

export interface NomosPluginAPI {
  registerEditorExtension: (extension: Extension) => void;
  registerPanel: (id: string, opts: { icon: string; title: string; render: (container: HTMLElement) => void | (() => void) }) => void;
  registerCommand: (
    id: string,
    opts: { name: string; shortcut?: string; callback: () => void | Promise<void> },
  ) => void;
  registerStatusBarItem: (opts: { id?: string; render: (container: HTMLElement) => void | (() => void) }) => void;

  vault: PluginVaultAPI;

  on: (event: PluginEvent, cb: (...args: any[]) => void) => void;
  off: (event: PluginEvent, cb: (...args: any[]) => void) => void;

  // プラグイン側が CodeMirror 6 の拡張を組むための最小エクスポート。
  // 必要なものは順次増やす。
  codemirror: PluginCodemirrorAPI;
}

