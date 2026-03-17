import { useState, useEffect, useCallback, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FileTree } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { TabBar } from "./components/TabBar";
import { MarginPanel } from "./components/MarginPanel";
import { GitPanel } from "./components/GitPanel";
import { NotificationContainer } from "./components/NotificationContainer";
import { AiChatPanel } from "./components/AiChatPanel";
import { useVault } from "./hooks/useVault";
import { useAppMenu } from "./hooks/useAppMenu";
import { useGit } from "./hooks/useGit";
import { useAI } from "./hooks/useAI";
import { isViewableFile } from "./components/FileViewer";
import type { EditorTab, MarginAnnotation } from "./types";
import "./App.css";

const AUTO_SAVE_DELAY = 1000;

let tabCounter = 0;
function newTabId() { return `tab-${++tabCounter}`; }

function App() {
  const {
    files,
    listFiles,
    openFile,
    saveFile,
    createFile,
    createDir,
    deleteFile,
    getMarginAnnotations,
    getBacklinks,
  } = useVault();

  const [tabs, setTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [marginOpen, setMarginOpen] = useState(true);
  const [gitOpen, setGitOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const { modelStatus, messages, isGenerating, loadModel, generateText, clearMessages } = useAI();
  const { status: gitStatus, commits: gitCommits, refresh: refreshGit,
    stage: gitStage, unstage: gitUnstage, commit: gitCommit, initRepo: gitInit } = useGit();
  const [folderExpandSignal, setFolderExpandSignal] = useState<boolean | null>(null);
  const [vaultName, setVaultName] = useState("");
  const [vaultPath, setVaultPath] = useState("");

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contradictionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // activeTabId を ref でも保持（クロージャ内から参照するため）
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTabId;

  useEffect(() => {
    listFiles();
    invoke<{ vault: { path: string } }>("get_config").then((cfg) => {
      const p = cfg.vault.path.replace(/\/$/, "");
      setVaultPath(p);
      setVaultName(p.split("/").pop() ?? p);
    });
    refreshGit();
  }, [listFiles]);

  useEffect(() => {
    const unlisten = listen("vault:changed", () => {
      listFiles();
      refreshGit();
    });
    return () => { unlisten.then((f) => f()); };
  }, [listFiles, refreshGit]);

  const handleSelectFile = useCallback(async (path: string) => {
    // 既に開いているタブがあればそちらへ切り替え
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      setActiveTabId(existing.id);
      return;
    }

    if (isViewableFile(path)) {
      const id = newTabId();
      setTabs((prev) => [...prev, {
        id, path, content: "", savedContent: "", isDirty: false, annotations: [], backlinks: [],
      }]);
      setActiveTabId(id);
      return;
    }

    const note = await openFile(path);
    if (!note) return;

    const [annots, bls] = await Promise.all([
      getMarginAnnotations(path),
      getBacklinks(path),
    ]);

    const id = newTabId();
    setTabs((prev) => [...prev, {
      id,
      path,
      content: note.content,
      savedContent: note.content,
      isDirty: false,
      annotations: annots,
      backlinks: bls,
    }]);
    setActiveTabId(id);
  }, [tabs, openFile, getMarginAnnotations, getBacklinks]);

  const handleCloseTab = useCallback(async (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (tab?.isDirty) {
      await saveFile(tab.path, tab.content);
    }

    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTabIdRef.current === id) {
        // 隣のタブへ移動
        const idx = prev.findIndex((t) => t.id === id);
        const nextActive = next[Math.min(idx, next.length - 1)]?.id ?? null;
        setActiveTabId(nextActive);
      }
      return next;
    });
  }, [tabs, saveFile]);

  const handleSwitchTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const handleEditorChange = useCallback((value: string) => {
    const id = activeTabIdRef.current;
    if (!id) return;

    setTabs((prev) => prev.map((t) =>
      t.id === id ? { ...t, content: value, isDirty: value !== t.savedContent } : t
    ));

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      const tabId = activeTabIdRef.current;
      if (!tabId) return;

      // 最新のタブ情報を取得
      setTabs((prev) => {
        const tab = prev.find((t) => t.id === tabId);
        if (!tab) return prev;

        saveFile(tab.path, tab.content).then(async () => {
          const annots = await getMarginAnnotations(tab.path);
          refreshGit();

          setTabs((cur) => cur.map((t) =>
            t.id === tabId ? { ...t, savedContent: t.content, isDirty: false, annotations: annots } : t
          ));

          if (contradictionTimer.current) clearTimeout(contradictionTimer.current);
          contradictionTimer.current = setTimeout(async () => {
            const contradictions = await invoke<MarginAnnotation[]>("detect_contradictions", { path: tab.path }).catch(() => []);
            if (contradictions.length > 0) {
              setTabs((cur) => cur.map((t) =>
                t.id === tabId ? {
                  ...t,
                  annotations: [
                    ...t.annotations.filter((a) => a.annotation_type !== "contradiction"),
                    ...contradictions,
                  ],
                } : t
              ));
            }
          }, 2000);
        });

        return prev;
      });
    }, AUTO_SAVE_DELAY);
  }, [saveFile, getMarginAnnotations, refreshGit]);

  const handleCreate = useCallback(async (name: string) => {
    await createFile(name);
    await listFiles();
  }, [createFile, listFiles]);

  const handleCreateDir = useCallback(async (name: string) => {
    await createDir(name);
    await listFiles();
  }, [createDir, listFiles]);

  const handleDelete = useCallback(async (path: string) => {
    await deleteFile(path);
    // 開いているタブを閉じる
    const tab = tabs.find((t) => t.path === path);
    if (tab) {
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== tab.id);
        if (activeTabIdRef.current === tab.id) {
          const idx = prev.findIndex((t) => t.id === tab.id);
          setActiveTabId(next[Math.min(idx, next.length - 1)]?.id ?? null);
        }
        return next;
      });
    }
  }, [deleteFile, tabs]);

  const handleOpenNote = useCallback((path: string) => {
    handleSelectFile(path);
  }, [handleSelectFile]);

  const handleOpenFolder = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const dir = typeof selected === "string" ? selected : selected[0];
    const currentConfig = await invoke<Record<string, unknown>>("get_config");
    const vault = currentConfig.vault as Record<string, unknown>;
    await invoke("update_config", {
      config: { ...currentConfig, vault: { ...vault, path: dir } }
    });
    setTabs([]);
    setActiveTabId(null);
    const p1 = dir.replace(/\/$/, "");
    setVaultPath(p1);
    setVaultName(p1.split("/").pop() ?? p1);
    await listFiles();
  }, [listFiles]);

  const handleCloseFolder = useCallback(() => {
    setFolderExpandSignal(false);
    setTimeout(() => setFolderExpandSignal(null), 0);
  }, []);

  const handleNewNote = useCallback(() => {
    window.dispatchEvent(new CustomEvent("nomos:new-note"));
  }, []);

  const handleSelectVault = useCallback(async () => {
    const selected = await open({ directory: true, multiple: false });
    if (!selected) return;
    const dir = typeof selected === "string" ? selected : selected[0];
    const currentConfig = await invoke<Record<string, unknown>>("get_config");
    const vault = currentConfig.vault as Record<string, unknown>;
    await invoke("update_config", {
      config: { ...currentConfig, vault: { ...vault, path: dir } }
    });
    setTabs([]);
    setActiveTabId(null);
    const p2 = dir.replace(/\/$/, "");
    setVaultPath(p2);
    setVaultName(p2.split("/").pop() ?? p2);
    await listFiles();
  }, [listFiles]);

  useAppMenu({
    onOpenVault: handleSelectVault,
    onOpenFolder: handleOpenFolder,
    onCloseFolder: handleCloseFolder,
    onNewNote: handleNewNote,
  });

  return (
    <div className="app">
      <NotificationContainer />
      <header className="app-header">
        <div className="app-header-left">
          <button
            className="header-btn"
            onClick={() => setSidebarOpen((v) => !v)}
            title="サイドバー"
          >
            ☰
          </button>
          <span className="app-title">Nomos</span>
        </div>
        <div className="app-header-right">
          {activeTab?.isDirty && <span className="save-indicator">未保存</span>}
          <button
            className={`header-btn ${gitOpen ? "active" : ""}`}
            onClick={() => setGitOpen((v) => !v)}
            title="Git"
          >
            ⎇
          </button>
          <button
            className={`header-btn ${aiOpen ? "active" : ""}`}
            onClick={() => setAiOpen((v) => !v)}
            title="AI Chat (Gemma)"
          >
            ✦
          </button>
          <button
            className="header-btn"
            onClick={() => setMarginOpen((v) => !v)}
            title="Judgement Brain"
          >
            ◧
          </button>
        </div>
      </header>

      <TabBar
        tabs={tabs}
        activeId={activeTabId}
        onSwitch={handleSwitchTab}
        onClose={handleCloseTab}
      />

      <div className="app-body">
        {sidebarOpen && (
          <FileTree
            files={files}
            selectedPath={activeTab?.path ?? null}
            forceExpanded={folderExpandSignal}
            vaultName={vaultName}
            vaultPath={vaultPath}
            gitFiles={gitStatus.files}
            onSelect={handleSelectFile}
            onCreate={handleCreate}
            onCreateDir={handleCreateDir}
            onDelete={handleDelete}
          />
        )}

        <main className="editor-main">
          <Editor
            content={activeTab?.content ?? ""}
            filePath={activeTab?.path ?? null}
            isDirty={activeTab?.isDirty ?? false}
            onChange={handleEditorChange}
            onNavigate={handleOpenNote}
          />
        </main>

        {gitOpen && (
          <GitPanel
            status={gitStatus}
            commits={gitCommits}
            onRefresh={refreshGit}
            onStage={gitStage}
            onUnstage={gitUnstage}
            onCommit={gitCommit}
            onInit={gitInit}
          />
        )}

        {aiOpen && (
          <AiChatPanel
            modelStatus={modelStatus}
            messages={messages}
            isGenerating={isGenerating}
            onLoadModel={loadModel}
            onGenerate={generateText}
            onClear={clearMessages}
          />
        )}

        {marginOpen && (
          <MarginPanel
            annotations={activeTab?.annotations ?? []}
            backlinks={activeTab?.backlinks ?? []}
            onOpenNote={handleOpenNote}
          />
        )}
      </div>
    </div>
  );
}

export default App;
