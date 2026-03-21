import { invoke } from "@tauri-apps/api/core";
import { Decoration, EditorView, MatchDecorator, ViewPlugin } from "@codemirror/view";
import type { Extension } from "@codemirror/state";
import type { PluginEvent, PluginVaultAPI, NomosPluginAPI, PluginPanelRegistration, PluginCommandRegistration, PluginStatusBarItemRegistration } from "./types";
import type { FileEntry, NoteContent } from "../types";

type EventBus = {
  on: (event: PluginEvent, cb: (...args: any[]) => void) => void;
  off: (event: PluginEvent, cb: (...args: any[]) => void) => void;
};

type RegistrationCollector = {
  extensions: Extension[];
  panels: Map<string, PluginPanelRegistration>;
  commands: Map<string, PluginCommandRegistration>;
  statusBarItems: Map<string, PluginStatusBarItemRegistration>;
};

function createVaultAPI(): PluginVaultAPI {
  return {
    async read(path: string) {
      const note = await invoke<NoteContent>("open_file", { path });
      return note.content;
    },
    async list(dir?: string) {
      const entries = await invoke<FileEntry[]>("list_files", { path: dir ?? null });
      return entries.map((e) => e.name);
    },
  };
}

export function createNomosPluginAPI(args: {
  pluginId: string;
  events: EventBus;
  collector: RegistrationCollector;
}): NomosPluginAPI {
  const { pluginId, events, collector } = args;
  const vault = createVaultAPI();

  return {
    registerEditorExtension(extension) {
      collector.extensions.push(extension);
    },
    registerPanel(id, opts) {
      const globalId = id.includes(":") ? id : `${pluginId}:${id}`;
      collector.panels.set(globalId, { id: globalId, icon: opts.icon, title: opts.title, render: opts.render });
    },
    registerCommand(id, opts) {
      const globalId = id.includes(":") ? id : `${pluginId}:${id}`;
      collector.commands.set(globalId, { id: globalId, name: opts.name, shortcut: opts.shortcut, callback: opts.callback });
    },
    registerStatusBarItem(opts) {
      const localId = opts.id ?? `item-${collector.statusBarItems.size}`;
      const globalId = localId.includes(":") ? localId : `${pluginId}:${localId}`;
      collector.statusBarItems.set(globalId, { id: globalId, render: opts.render });
    },
    vault,
    on: (event, cb) => {
      events.on(event, cb);
    },
    off: (event, cb) => events.off(event, cb),
    codemirror: {
      EditorView,
      ViewPlugin,
      Decoration,
      MatchDecorator,
    },
  };
}

