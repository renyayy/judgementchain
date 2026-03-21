import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FileTree } from "./components/FileTree";
import { EditorPane, type PaneState } from "./components/EditorPane";
import { MarginPanel } from "./components/MarginPanel";
import { GitPanel } from "./components/GitPanel";
import { NotificationContainer } from "./components/NotificationContainer";
import { AiChatPanel } from "./components/AiChatPanel";
import GraphPanel from "./components/GraphPanel";
import { TerminalPanel } from "./components/TerminalPanel";
import { LeftActivityBar, RightActivityBar } from "./components/ActivityBar";
import { GemmaTermsModal, isGemmaTermsAccepted } from "./components/GemmaTermsModal";
import { useVault } from "./hooks/useVault";
import { useAppMenu } from "./hooks/useAppMenu";
import { useGit } from "./hooks/useGit";
import { useAI } from "./hooks/useAI";
import { useSettings } from "./hooks/useSettings";
import { isViewableFile } from "./components/FileViewer";
import type { EditorTab, MarginAnnotation } from "./types";
import "./App.css";

const AUTO_SAVE_DELAY = 1000;
let tabCounter = 0;
const newTabId = () => `tab-${++tabCounter}`;
const EMPTY_PANE: PaneState = { tabs: [], activeId: null };

function App() {
  const { files, listFiles, openFile, saveFile, createFile, createDir, deleteFile, renameFile, getMarginAnnotations, getBacklinks } = useVault();

  const [leftPane, setLeftPane] = useState<PaneState>(EMPTY_PANE);
  const [rightPane, setRightPane] = useState<PaneState>(EMPTY_PANE);
  const [splitOpen, setSplitOpen] = useState(false);
  const [activePaneId, setActivePaneId] = useState<"left" | "right">("left");

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanel, setRightPanel] = useState<"git" | "ai" | "graph" | "margin" | null>("margin");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [vaultName, setVaultName] = useState("");

  const toggleRightPanel = (panel: "git" | "ai" | "graph" | "margin") => {
    setRightPanel((prev) => (prev === panel ? null : panel));
  };
  const [vaultPath, setVaultPath] = useState("");
  const [showGemmaTerms, setShowGemmaTerms] = useState(false);

  const { settings, updateSettings } = useSettings();
  const { modelStatus, messages, isGenerating, loadModel, generateText, clearMessages } = useAI();
  const { status: gitStatus, commits: gitCommits, refresh: refreshGit, stage: gitStage, unstage: gitUnstage, discard: gitDiscard, commit: gitCommit, initRepo: gitInit } = useGit();
  const [folderExpandSignal, setFolderExpandSignal] = useState<boolean | null>(null);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contradictionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activePaneIdRef = useRef<"left" | "right">("left");
  activePaneIdRef.current = activePaneId;

  // ---- helpers ----------------------------------------------------------------

  const setPane = useCallback((id: "left" | "right", fn: (p: PaneState) => PaneState) => {
    if (id === "left") setLeftPane(fn);
    else setRightPane(fn);
  }, []);

  const getPane = useCallback((id: "left" | "right") =>
    id === "left" ? leftPane : rightPane,
  [leftPane, rightPane]);

  const activeTab = useMemo(() => {
    const p = activePaneId === "left" ? leftPane : rightPane;
    return p.tabs.find((t) => t.id === p.activeId) ?? null;
  }, [activePaneId, leftPane, rightPane]);

  // ---- initial load -----------------------------------------------------------

  useEffect(() => {
    listFiles();
    invoke<{ vault: { path: string }; ai: { backend: string } }>("get_config").then((cfg) => {
      const p = cfg.vault.path.replace(/\/$/, "");
      setVaultPath(p);
      setVaultName(p.split("/").pop() ?? p);
      if (cfg.ai.backend === "vertex" && !isGemmaTermsAccepted()) {
        setShowGemmaTerms(true);
      }
    });
    refreshGit();
  }, [listFiles]);

  // ---- auto-generate weekly summary when model is ready --------------------

  useEffect(() => {
    if (modelStatus !== "ready") return;
    invoke<string | null>("get_weekly_summary").then((summary) => {
      if (summary !== null) return;
      invoke<string>("generate_weekly_summary")
        .then(() => {
          // サマリー生成後、アクティブタブのアノテーションを更新
          const pane = activePaneId === "left" ? leftPane : rightPane;
          const tab = pane.tabs.find((t) => t.id === pane.activeId);
          if (tab?.tabType === "file") {
            getMarginAnnotations(tab.path).then((annots) => {
              const setPaneLocal = activePaneId === "left" ? setLeftPane : setRightPane;
              setPaneLocal((cur) => ({
                ...cur,
                tabs: cur.tabs.map((t) =>
                  t.id === tab.id ? { ...t, annotations: annots } : t
                ),
              }));
            });
          }
        })
        .catch(() => {});
    }).catch(() => {});
  }, [modelStatus]);

  useEffect(() => {
    const u = listen("vault:changed", () => { listFiles(); refreshGit(); });
    return () => { u.then((f) => f()); };
  }, [listFiles, refreshGit]);

  // ---- open file in pane ------------------------------------------------------

  const openFileInPane = useCallback(async (path: string, paneId: "left" | "right") => {
    const pane = paneId === "left" ? leftPane : rightPane;
    const existing = pane.tabs.find((t) => t.path === path && t.tabType === "file");
    if (existing) {
      setPane(paneId, (p) => ({ ...p, activeId: existing.id }));
      setActivePaneId(paneId);
      return;
    }

    if (isViewableFile(path)) {
      const id = newTabId();
      setPane(paneId, (p) => ({
        tabs: [...p.tabs, { id, path, tabType: "file", content: "", savedContent: "", isDirty: false, annotations: [], backlinks: [] }],
        activeId: id,
      }));
      setActivePaneId(paneId);
      return;
    }

    const note = await openFile(path);
    if (!note) return;
    const [annots, bls] = await Promise.all([getMarginAnnotations(path), getBacklinks(path)]);
    const id = newTabId();
    setPane(paneId, (p) => ({
      tabs: [...p.tabs, { id, path, tabType: "file", content: note.content, savedContent: note.content, isDirty: false, annotations: annots, backlinks: bls }],
      activeId: id,
    }));
    setActivePaneId(paneId);
  }, [leftPane, rightPane, openFile, getMarginAnnotations, getBacklinks, setPane]);

  const handleSelectFile = useCallback((path: string) =>
    openFileInPane(path, activePaneIdRef.current),
  [openFileInPane]);

  // ---- diff / commit tabs -----------------------------------------------------

  const openSpecialTab = useCallback((tab: Omit<EditorTab, "id">, paneId: "left" | "right") => {
    const pane = paneId === "left" ? leftPane : rightPane;
    const existing = pane.tabs.find((t) => t.tabType === tab.tabType && t.path === tab.path);
    if (existing) {
      setPane(paneId, (p) => ({ ...p, activeId: existing.id }));
      setActivePaneId(paneId);
      return;
    }
    const id = newTabId();
    setPane(paneId, (p) => ({
      tabs: [...p.tabs, { ...tab, id }],
      activeId: id,
    }));
    setActivePaneId(paneId);
  }, [leftPane, rightPane, setPane]);

  const handleOpenDiff = useCallback((path: string, rawDiff: string) => {
    openSpecialTab({ path, tabType: "diff", content: "", savedContent: "", isDirty: false, rawDiff, annotations: [], backlinks: [] }, activePaneIdRef.current);
  }, [openSpecialTab]);

  const handleOpenCommit = useCallback((hash: string, rawDiff: string) => {
    openSpecialTab({ path: `commit:${hash}`, tabType: "commit", content: "", savedContent: "", isDirty: false, rawDiff, annotations: [], backlinks: [] }, activePaneIdRef.current);
  }, [openSpecialTab]);

  // ---- close tab --------------------------------------------------------------

  const closeTabInPane = useCallback(async (tabId: string, paneId: "left" | "right") => {
    const tab = getPane(paneId).tabs.find((t) => t.id === tabId);
    if (tab?.isDirty && tab.tabType === "file") await saveFile(tab.path, tab.content);
    setPane(paneId, (prev) => {
      const next = prev.tabs.filter((t) => t.id !== tabId);
      let newActiveId = prev.activeId;
      if (prev.activeId === tabId) {
        const idx = prev.tabs.findIndex((t) => t.id === tabId);
        newActiveId = next[Math.min(idx, next.length - 1)]?.id ?? null;
      }
      if (paneId === "right" && next.length === 0) setSplitOpen(false);
      return { tabs: next, activeId: newActiveId };
    });
  }, [getPane, saveFile, setPane]);

  const closeOthersInPane = useCallback(async (tabId: string, paneId: "left" | "right") => {
    const pane = getPane(paneId);
    for (const tab of pane.tabs) {
      if (tab.id !== tabId && tab.isDirty && tab.tabType === "file") await saveFile(tab.path, tab.content);
    }
    setPane(paneId, (prev) => ({
      tabs: prev.tabs.filter((t) => t.id === tabId),
      activeId: tabId,
    }));
  }, [getPane, saveFile, setPane]);

  const closeToRightInPane = useCallback(async (tabId: string, paneId: "left" | "right") => {
    const pane = getPane(paneId);
    const idx = pane.tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    for (const tab of pane.tabs.slice(idx + 1)) {
      if (tab.isDirty && tab.tabType === "file") await saveFile(tab.path, tab.content);
    }
    setPane(paneId, (prev) => {
      const next = prev.tabs.slice(0, idx + 1);
      const activeId = next.some((t) => t.id === prev.activeId) ? prev.activeId : (next[next.length - 1]?.id ?? null);
      if (paneId === "right" && next.length === 0) setSplitOpen(false);
      return { tabs: next, activeId };
    });
  }, [getPane, saveFile, setPane]);

  const closeAllInPane = useCallback(async (paneId: "left" | "right") => {
    const pane = getPane(paneId);
    for (const tab of pane.tabs) {
      if (tab.isDirty && tab.tabType === "file") await saveFile(tab.path, tab.content);
    }
    if (paneId === "right") setSplitOpen(false);
    setPane(paneId, () => ({ tabs: [], activeId: null }));
  }, [getPane, saveFile, setPane]);

  // ---- terminal ---------------------------------------------------------------

  const handleTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = terminalHeight;
    const onMove = (ev: MouseEvent) => {
      setTerminalHeight(Math.max(100, Math.min(600, startHeight + startY - ev.clientY)));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [terminalHeight]);

  // ---- split (open in other pane) ---------------------------------------------

  const handleSplitTab = useCallback((tabId: string, fromPaneId: "left" | "right") => {
    const toPaneId: "left" | "right" = fromPaneId === "left" ? "right" : "left";
    const tab = getPane(fromPaneId).tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.tabType === "file") {
      openFileInPane(tab.path, toPaneId);
    } else {
      openSpecialTab({ ...tab }, toPaneId);
    }
    setSplitOpen(true);
  }, [getPane, openFileInPane, openSpecialTab]);

  // ---- editor change (auto-save) ----------------------------------------------

  const handleEditorChange = useCallback((value: string, paneId: "left" | "right") => {
    const setPaneLocal = paneId === "left" ? setLeftPane : setRightPane;
    setPaneLocal((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) =>
        t.id === prev.activeId ? { ...t, content: value, isDirty: value !== t.savedContent } : t
      ),
    }));

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      setPaneLocal((prev) => {
        const tab = prev.tabs.find((t) => t.id === prev.activeId);
        if (!tab || tab.tabType !== "file") return prev;
        saveFile(tab.path, tab.content).then(async () => {
          const annots = await getMarginAnnotations(tab.path);
          refreshGit();
          setPaneLocal((cur) => ({
            ...cur,
            tabs: cur.tabs.map((t) =>
              t.id === tab.id ? { ...t, savedContent: t.content, isDirty: false, annotations: annots } : t
            ),
          }));
          if (contradictionTimer.current) clearTimeout(contradictionTimer.current);
          contradictionTimer.current = setTimeout(async () => {
            const cs = await invoke<MarginAnnotation[]>("detect_contradictions", { path: tab.path }).catch(() => []);
            if (cs.length > 0) {
              setPaneLocal((cur) => ({
                ...cur,
                tabs: cur.tabs.map((t) =>
                  t.id === tab.id ? { ...t, annotations: [...t.annotations.filter((a) => a.annotation_type !== "contradiction" && a.annotation_type !== "self_contradiction"), ...cs] } : t
                ),
              }));
            }
          }, 2000);
        });
        return prev;
      });
    }, AUTO_SAVE_DELAY);
  }, [saveFile, getMarginAnnotations, refreshGit]);

  // ---- file tree operations ---------------------------------------------------

  const handleCreate = useCallback(async (name: string) => { await createFile(name); await listFiles(); }, [createFile, listFiles]);
  const handleCreateDir = useCallback(async (name: string) => { await createDir(name); await listFiles(); }, [createDir, listFiles]);
  const handleDelete = useCallback(async (path: string) => {
    await deleteFile(path);
    for (const paneId of ["left", "right"] as const) {
      const affectedTabs = getPane(paneId).tabs.filter(
        (t) => t.tabType === "file" && (t.path === path || t.path.startsWith(`${path}/`))
      );
      for (const tab of affectedTabs) await closeTabInPane(tab.id, paneId);
    }
  }, [deleteFile, getPane, closeTabInPane]);

  const handleRename = useCallback(async (oldPath: string, newPath: string) => {
    const ok = await renameFile(oldPath, newPath);
    if (!ok) return;

    const updatePath = (p: string) => {
      if (p === oldPath) return newPath;
      if (p.startsWith(`${oldPath}/`)) return `${newPath}${p.slice(oldPath.length)}`;
      return p;
    };

    const leftAffected = leftPane.tabs
      .filter((t) => t.tabType === "file" && (t.path === oldPath || t.path.startsWith(`${oldPath}/`)))
      .map((t) => ({ tabId: t.id, newPath: updatePath(t.path) }));
    const rightAffected = rightPane.tabs
      .filter((t) => t.tabType === "file" && (t.path === oldPath || t.path.startsWith(`${oldPath}/`)))
      .map((t) => ({ tabId: t.id, newPath: updatePath(t.path) }));

    if (leftAffected.length > 0) {
      const map = new Map(leftAffected.map((a) => [a.tabId, a.newPath] as const));
      setLeftPane((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t) => (map.has(t.id) ? { ...t, path: map.get(t.id)! } : t)),
      }));
    }
    if (rightAffected.length > 0) {
      const map = new Map(rightAffected.map((a) => [a.tabId, a.newPath] as const));
      setRightPane((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t) => (map.has(t.id) ? { ...t, path: map.get(t.id)! } : t)),
      }));
    }

    const affectedAll = [
      ...leftAffected.map((a) => ({ ...a, paneId: "left" as const })),
      ...rightAffected.map((a) => ({ ...a, paneId: "right" as const })),
    ];
    if (affectedAll.length === 0) return;

    const results = await Promise.all(
      affectedAll.map(async ({ tabId, newPath, paneId }) => ({
        paneId,
        tabId,
        annotations: await getMarginAnnotations(newPath),
        backlinks: await getBacklinks(newPath),
      }))
    );

    const leftUpdates = results.filter((r) => r.paneId === "left");
    const rightUpdates = results.filter((r) => r.paneId === "right");

    if (leftUpdates.length > 0) {
      const map = new Map(leftUpdates.map((r) => [r.tabId, { annotations: r.annotations, backlinks: r.backlinks }] as const));
      setLeftPane((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t) => {
          const u = map.get(t.id);
          return u ? { ...t, annotations: u.annotations, backlinks: u.backlinks } : t;
        }),
      }));
    }

    if (rightUpdates.length > 0) {
      const map = new Map(rightUpdates.map((r) => [r.tabId, { annotations: r.annotations, backlinks: r.backlinks }] as const));
      setRightPane((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t) => {
          const u = map.get(t.id);
          return u ? { ...t, annotations: u.annotations, backlinks: u.backlinks } : t;
        }),
      }));
    }
  }, [
    renameFile,
    leftPane,
    rightPane,
    setLeftPane,
    setRightPane,
    getMarginAnnotations,
    getBacklinks,
  ]);

  const handleOpenNote = useCallback((path: string) => handleSelectFile(path), [handleSelectFile]);

  // ---- settings tab -----------------------------------------------------------

  const openSettingsTab = useCallback(() => {
    openSpecialTab({
      path: "settings",
      tabType: "settings",
      content: "",
      savedContent: "",
      isDirty: false,
      annotations: [],
      backlinks: [],
    }, activePaneIdRef.current);
  }, [openSpecialTab]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        openSettingsTab();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openSettingsTab]);

  // ---- vault change -----------------------------------------------------------

  const resetVault = useCallback(async (dir: string) => {
    const currentConfig = await invoke<Record<string, unknown>>("get_config");
    const vault = currentConfig.vault as Record<string, unknown>;
    await invoke("update_config", { config: { ...currentConfig, vault: { ...vault, path: dir } } });
    setLeftPane(EMPTY_PANE);
    setRightPane(EMPTY_PANE);
    setSplitOpen(false);
    const p = dir.replace(/\/$/, "");
    setVaultPath(p);
    setVaultName(p.split("/").pop() ?? p);
    await listFiles();
  }, [listFiles]);

  useAppMenu({
    onOpenVault: async () => {
      const s = await open({ directory: true, multiple: false });
      if (s) await resetVault(typeof s === "string" ? s : s[0]);
    },
    onOpenFolder: async () => {
      const s = await open({ directory: true, multiple: false });
      if (s) await resetVault(typeof s === "string" ? s : s[0]);
    },
    onCloseFolder: () => { setFolderExpandSignal(false); setTimeout(() => setFolderExpandSignal(null), 0); },
    onNewNote: () => window.dispatchEvent(new CustomEvent("nomos:new-note")),
  });

  const showRight = splitOpen && rightPane.tabs.length > 0;

  return (
    <div className="app">
      <NotificationContainer />
      {showGemmaTerms && (
        <GemmaTermsModal
          onAccept={() => setShowGemmaTerms(false)}
          onDecline={() => setShowGemmaTerms(false)}
        />
      )}
      <header className="app-header">
        <div className="app-header-left">
          <span className="app-title">Nomos</span>
        </div>
        <div className="app-header-right">
          {activeTab?.isDirty && <span className="save-indicator">未保存</span>}
          <button className={`header-btn ${splitOpen ? "active" : ""}`} onClick={() => setSplitOpen((v) => !v)} title="分割表示">◫</button>
          <button className="header-btn" onClick={openSettingsTab} title="設定">⚙</button>
        </div>
      </header>

      <div className="app-body">
        <LeftActivityBar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          terminalOpen={terminalOpen}
          onToggleTerminal={() => setTerminalOpen((v) => !v)}
        />
        <div className="app-body-center">
        <div className="app-body-main">
        {sidebarOpen && (
          <FileTree
            files={files}
            selectedPath={activeTab?.tabType === "file" ? activeTab.path : null}
            forceExpanded={folderExpandSignal}
            vaultName={vaultName}
            vaultPath={vaultPath}
            gitFiles={gitStatus.files}
            onSelect={handleSelectFile}
            onCreate={handleCreate}
            onCreateDir={handleCreateDir}
            onDelete={handleDelete}
            onRename={handleRename}
          />
        )}

        <main className="editor-main">
          <EditorPane
            pane={leftPane}
            isActive={activePaneId === "left"}
            settings={settings}
            onUpdateSettings={updateSettings}
            onFocus={() => setActivePaneId("left")}
            onSwitch={(id) => setLeftPane((p) => ({ ...p, activeId: id }))}
            onClose={(id) => closeTabInPane(id, "left")}
            onSplit={(id) => handleSplitTab(id, "left")}
            onCloseOthers={(id) => closeOthersInPane(id, "left")}
            onCloseToRight={(id) => closeToRightInPane(id, "left")}
            onCloseAll={() => closeAllInPane("left")}
            onEditorChange={(v) => handleEditorChange(v, "left")}
            onNavigate={handleOpenNote}
          />
          {showRight && (
            <>
              <div className="pane-divider" />
              <EditorPane
                pane={rightPane}
                isActive={activePaneId === "right"}
                settings={settings}
                onUpdateSettings={updateSettings}
                onFocus={() => setActivePaneId("right")}
                onSwitch={(id) => setRightPane((p) => ({ ...p, activeId: id }))}
                onClose={(id) => closeTabInPane(id, "right")}
                onSplit={(id) => handleSplitTab(id, "right")}
                onCloseOthers={(id) => closeOthersInPane(id, "right")}
                onCloseToRight={(id) => closeToRightInPane(id, "right")}
                onCloseAll={() => closeAllInPane("right")}
                onEditorChange={(v) => handleEditorChange(v, "right")}
                onNavigate={handleOpenNote}
              />
            </>
          )}
        </main>

        {rightPanel === "git" && (
          <GitPanel
            status={gitStatus}
            commits={gitCommits}
            onRefresh={refreshGit}
            onStage={gitStage}
            onUnstage={gitUnstage}
            onCommit={gitCommit}
            onInit={gitInit}
            onDiscard={gitDiscard}
            onOpenDiff={handleOpenDiff}
            onOpenCommit={handleOpenCommit}
          />
        )}
        {rightPanel === "ai" && (
          <AiChatPanel
            modelStatus={modelStatus}
            messages={messages}
            isGenerating={isGenerating}
            onLoadModel={loadModel}
            onGenerate={generateText}
            onClear={clearMessages}
          />
        )}
        {rightPanel === "graph" && (
          <GraphPanel
            vaultPath={vaultPath}
            onOpenFile={handleSelectFile}
          />
        )}
        {rightPanel === "margin" && (
          <MarginPanel
            annotations={activeTab?.annotations ?? []}
            backlinks={activeTab?.backlinks ?? []}
            onOpenNote={handleOpenNote}
            onRefreshAnnotations={() => {
              const pane = activePaneId === "left" ? leftPane : rightPane;
              const tab = pane.tabs.find((t) => t.id === pane.activeId);
              if (tab?.tabType === "file") {
                getMarginAnnotations(tab.path).then((annots) => {
                  const setPaneLocal = activePaneId === "left" ? setLeftPane : setRightPane;
                  setPaneLocal((cur) => ({
                    ...cur,
                    tabs: cur.tabs.map((t) =>
                      t.id === tab.id ? { ...t, annotations: annots } : t
                    ),
                  }));
                });
              }
            }}
          />
        )}
        </div>{/* app-body-main */}
        <TerminalPanel
          isOpen={terminalOpen}
          height={terminalHeight}
          vaultPath={vaultPath}
          onResizeStart={handleTerminalResizeStart}
        />
      </div>{/* app-body-center */}
        <RightActivityBar
          rightPanel={rightPanel}
          onToggleRightPanel={toggleRightPanel}
        />
      </div>
    </div>
  );
}

export default App;
