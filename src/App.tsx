import { useState, useEffect, useCallback, useRef } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { FileTree } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { MarginPanel } from "./components/MarginPanel";
import { useVault } from "./hooks/useVault";
import { useAppMenu } from "./hooks/useAppMenu";
import { isViewableFile } from "./components/FileViewer";
import type { MarginAnnotation, Backlink } from "./types";
import "./App.css";

const AUTO_SAVE_DELAY = 1000;

function App() {
  const {
    files,
    listFiles,
    openFile,
    saveFile,
    createFile,
    deleteFile,
    getMarginAnnotations,
    getBacklinks,
  } = useVault();

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [annotations, setAnnotations] = useState<MarginAnnotation[]>([]);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [marginOpen, setMarginOpen] = useState(true);
  const [folderExpandSignal, setFolderExpandSignal] = useState<boolean | null>(null);
  const [vaultName, setVaultName] = useState("");
  const [vaultPath, setVaultPath] = useState("");

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load
  useEffect(() => {
    listFiles();
    invoke<{ vault: { path: string } }>("get_config").then((cfg) => {
      const p = cfg.vault.path.replace(/\/$/, "");
      setVaultPath(p);
      setVaultName(p.split("/").pop() ?? p);
    });
  }, [listFiles]);

  const handleSelectFile = useCallback(async (path: string) => {
    if (isDirty && selectedPath) {
      await saveFile(selectedPath, content);
    }

    // 画像・PDF はファイル読み込み不要、パスだけセット
    if (isViewableFile(path)) {
      setSelectedPath(path);
      setContent("");
      setSavedContent("");
      setIsDirty(false);
      setAnnotations([]);
      setBacklinks([]);
      return;
    }

    const note = await openFile(path);
    if (note) {
      setSelectedPath(path);
      setContent(note.content);
      setSavedContent(note.content);
      setIsDirty(false);

      const [annots, bls] = await Promise.all([
        getMarginAnnotations(path),
        getBacklinks(path),
      ]);
      setAnnotations(annots);
      setBacklinks(bls);
    }
  }, [isDirty, selectedPath, content, openFile, saveFile, getMarginAnnotations, getBacklinks]);

  const handleEditorChange = useCallback((value: string) => {
    setContent(value);
    setIsDirty(value !== savedContent);

    // Auto-save
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      if (selectedPath) {
        await saveFile(selectedPath, value);
        setSavedContent(value);
        setIsDirty(false);

        // Refresh annotations after save
        const annots = await getMarginAnnotations(selectedPath);
        setAnnotations(annots);
      }
    }, AUTO_SAVE_DELAY);
  }, [savedContent, selectedPath, saveFile, getMarginAnnotations]);

  const handleCreate = useCallback(async (name: string) => {
    await createFile(name);
    await listFiles();
  }, [createFile, listFiles]);

  const handleDelete = useCallback(async (path: string) => {
    await deleteFile(path);
    if (selectedPath === path) {
      setSelectedPath(null);
      setContent("");
      setSavedContent("");
      setIsDirty(false);
      setAnnotations([]);
      setBacklinks([]);
    }
  }, [deleteFile, selectedPath]);

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
    setSelectedPath(null);
    setContent("");
    setSavedContent("");
    setAnnotations([]);
    setBacklinks([]);
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
    // FileTree の新規入力を開くため、カスタムイベントで通知
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
    setSelectedPath(null);
    setContent("");
    setSavedContent("");
    setAnnotations([]);
    setBacklinks([]);
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
          {isDirty && <span className="save-indicator">未保存</span>}
          <button
            className="header-btn"
            onClick={() => setMarginOpen((v) => !v)}
            title="Judgement Brain"
          >
            ◧
          </button>
        </div>
      </header>

      <div className="app-body">
        {sidebarOpen && (
          <FileTree
            files={files}
            selectedPath={selectedPath}
            forceExpanded={folderExpandSignal}
            vaultName={vaultName}
            vaultPath={vaultPath}
            onSelect={handleSelectFile}
            onCreate={handleCreate}
            onDelete={handleDelete}
          />
        )}

        <main className="editor-main">
          <Editor
            content={content}
            filePath={selectedPath}
            isDirty={isDirty}
            onChange={handleEditorChange}
          />
        </main>

        {marginOpen && (
          <MarginPanel
            annotations={annotations}
            backlinks={backlinks}
            onOpenNote={handleOpenNote}
          />
        )}
      </div>
    </div>
  );
}

export default App;
