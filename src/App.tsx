import { useState, useEffect, useCallback, useRef } from "react";
import { FileTree } from "./components/FileTree";
import { Editor } from "./components/Editor";
import { MarginPanel } from "./components/MarginPanel";
import { useVault } from "./hooks/useVault";
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

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load
  useEffect(() => {
    listFiles();
  }, [listFiles]);

  const handleSelectFile = useCallback(async (path: string) => {
    if (isDirty && selectedPath) {
      await saveFile(selectedPath, content);
    }

    const note = await openFile(path);
    if (note) {
      setSelectedPath(path);
      setContent(note.content);
      setSavedContent(note.content);
      setIsDirty(false);

      // Load margin data
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
            onSelect={handleSelectFile}
            onCreate={handleCreate}
            onDelete={handleDelete}
            onRefresh={listFiles}
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
