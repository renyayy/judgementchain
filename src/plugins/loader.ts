import { invoke } from "@tauri-apps/api/core";
import type { Extension } from "@codemirror/state";
import type { PluginManifest, PluginState, NomosPluginAPI, PluginEvent } from "./types";
import { createNomosPluginAPI } from "./api";
import type { PluginPanelRegistration, PluginCommandRegistration, PluginStatusBarItemRegistration } from "./types";

type EventBus = {
  on: (event: PluginEvent, cb: (...args: any[]) => void) => void;
  off: (event: PluginEvent, cb: (...args: any[]) => void) => void;
};

type Collector = {
  extensions: Extension[];
  panels: Map<string, PluginPanelRegistration>;
  commands: Map<string, PluginCommandRegistration>;
  statusBarItems: Map<string, PluginStatusBarItemRegistration>;
};

async function loadPluginModule(code: string): Promise<any> {
  const blob = new Blob([code], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function pickInitFn(mod: any): ((api: NomosPluginAPI) => void | Promise<void>) | null {
  const init = mod?.default ?? mod?.init ?? mod?.setup;
  if (typeof init === "function") return init;
  return null;
}

export async function loadPlugins(args: {
  events: EventBus;
  collector: Collector;
  isPluginEnabled: (manifest: PluginManifest, fileExists: boolean) => boolean;
}): Promise<PluginState[]> {
  const { events, collector, isPluginEnabled } = args;

  const manifests = await invoke<PluginManifest[]>("list_plugins").catch(() => []);
  const results: PluginState[] = [];

  await Promise.all(
    manifests.map(async (manifest) => {
      try {
        const filePath = manifest.main;
        const code = await invoke<string>("read_plugin_file", {
          pluginId: manifest.id,
          file: filePath,
        }).catch((e) => {
          // main.js が見つからない等もここで吸収
          // eslint-disable-next-line no-console
          console.warn(`Failed to read plugin file for ${manifest.id}:`, e);
          return null;
        });

        const fileExists = typeof code === "string" && code.length > 0;
        const enabledByManifest = manifest.enabled ?? true;
        const enabled = enabledByManifest && fileExists && isPluginEnabled(manifest, fileExists);

        if (!enabled) {
          results.push({
            manifest,
            enabled: false,
            status: fileExists ? "skipped" : "skipped",
          });
          return;
        }

        if (!code) {
          results.push({
            manifest,
            enabled: false,
            status: "skipped",
            error: "main.js not found",
          });
          return;
        }

        const pluginAPI = createNomosPluginAPI({
          pluginId: manifest.id,
          events,
          collector,
        });

        const mod = await loadPluginModule(code);
        const initFn = pickInitFn(mod);
        if (!initFn) {
          results.push({
            manifest,
            enabled: true,
            status: "error",
            error: "Plugin main.js must export default/init function",
          });
          return;
        }

        await initFn(pluginAPI);

        results.push({
          manifest,
          enabled: true,
          status: "loaded",
        });
      } catch (e: any) {
        results.push({
          manifest,
          enabled: false,
          status: "error",
          error: e?.message ?? String(e),
        });
      }
    }),
  );

  // results の manifest 欄が catch で欠ける可能性を避ける
  return results;
}

