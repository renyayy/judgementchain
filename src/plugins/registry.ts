import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Extension } from "@codemirror/state";
import { loadPlugins } from "./loader";
import type { PluginCommandRegistration, PluginPanelRegistration, PluginEvent, PluginState, PluginStatusBarItemRegistration } from "./types";

type EventBus = {
  on: (event: PluginEvent, cb: (...args: any[]) => void) => void;
  off: (event: PluginEvent, cb: (...args: any[]) => void) => void;
  emit: (event: PluginEvent, ...args: any[]) => void;
};

const STORAGE_KEY = "nomos.plugins.enabledOverrides";

function loadOverrides(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveOverrides(map: Record<string, boolean>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

function createEventBus(): EventBus {
  const listeners: Partial<Record<PluginEvent, Set<(...args: any[]) => void>>> = {};
  return {
    on(event, cb) {
      if (!listeners[event]) listeners[event] = new Set();
      listeners[event]!.add(cb);
    },
    off(event, cb) {
      listeners[event]?.delete(cb);
    },
    emit(event, ...args) {
      for (const cb of listeners[event] ?? []) {
        try {
          cb(...args);
        } catch (e: any) {
          // plugin callback errors must not break the app
        }
      }
    },
  };
}

type PluginRegistryContextValue = {
  loading: boolean;
  pluginStates: PluginState[];

  editorExtensions: Extension[];
  panels: PluginPanelRegistration[];
  commands: PluginCommandRegistration[];
  statusBarItems: PluginStatusBarItemRegistration[];

  reload: () => Promise<void>;
  setPluginEnabled: (pluginId: string, enabled: boolean) => void;

  emit: (event: PluginEvent, ...args: any[]) => void;
};

const PluginRegistryContext = createContext<PluginRegistryContextValue | null>(null);

export function PluginRegistryProvider({ children }: { children: React.ReactNode }) {
  const eventBusRef = useRef<EventBus | null>(null);
  if (!eventBusRef.current) eventBusRef.current = createEventBus();

  const [loading, setLoading] = useState(false);
  const [pluginStates, setPluginStates] = useState<PluginState[]>([]);
  const [editorExtensions, setEditorExtensions] = useState<Extension[]>([]);
  const [panels, setPanels] = useState<PluginPanelRegistration[]>([]);
  const [commands, setCommands] = useState<PluginCommandRegistration[]>([]);
  const [statusBarItems, setStatusBarItems] = useState<PluginStatusBarItemRegistration[]>([]);

  const reload = useCallback(async () => {
    const events = eventBusRef.current!;
    setLoading(true);

    try {
      const collector = {
        extensions: [] as Extension[],
        panels: new Map<string, PluginPanelRegistration>(),
        commands: new Map<string, PluginCommandRegistration>(),
        statusBarItems: new Map<string, PluginStatusBarItemRegistration>(),
      };

      const overrides = loadOverrides();
      const isPluginEnabled = (manifest: { id: string; enabled?: boolean }) => {
        if (manifest.id in overrides) return overrides[manifest.id];
        return manifest.enabled ?? true;
      };

      const states = await loadPlugins({
        events,
        collector,
        isPluginEnabled: (manifest: { id: string; enabled?: boolean }) => isPluginEnabled(manifest),
      } as any);

      setPluginStates(states);
      setEditorExtensions(collector.extensions);
      setPanels(Array.from(collector.panels.values()));
      setCommands(Array.from(collector.commands.values()));
      setStatusBarItems(Array.from(collector.statusBarItems.values()));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setPluginEnabled = useCallback((pluginId: string, enabled: boolean) => {
    const overrides = loadOverrides();
    overrides[pluginId] = enabled;
    saveOverrides(overrides);
    setPluginStates((prev) => prev.map((s) => (s.manifest.id === pluginId ? { ...s, enabled } : s)));
  }, []);

  const value = useMemo<PluginRegistryContextValue>(
    () => ({
      loading,
      pluginStates,
      editorExtensions,
      panels,
      commands,
      statusBarItems,
      reload,
      setPluginEnabled,
      emit: (event, ...args) => eventBusRef.current?.emit(event, ...args),
    }),
    [loading, pluginStates, editorExtensions, panels, commands, statusBarItems, reload, setPluginEnabled],
  );

  return React.createElement(PluginRegistryContext.Provider, { value }, children);
}

export function usePluginRegistry(): PluginRegistryContextValue {
  const ctx = useContext(PluginRegistryContext);
  if (!ctx) throw new Error("usePluginRegistry must be used within PluginRegistryProvider");
  return ctx;
}

