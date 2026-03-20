import { useState, useCallback, useEffect, useRef } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { FileEntry, GitFileStatus } from "../types";

interface FileTreeProps {
  files: FileEntry[];
  selectedPath: string | null;
  forceExpanded: boolean | null;
  vaultName: string;
  vaultPath: string;
  gitFiles: GitFileStatus[];
  onSelect: (path: string) => void;
  onCreate: (path: string) => void;
  onCreateDir: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (oldPath: string, newPath: string) => Promise<void>;
}

type CreateMode = "file" | "dir";

interface NewInputProps {
  parentDir: string | null;
  mode: CreateMode;
}

interface RenameState {
  target: FileEntry;
  name: string;
}

interface FileNodeProps {
  entry: FileEntry;
  depth: number;
  selectedPath: string | null;
  selectedDir: string | null;
  forceExpanded: boolean | null;
  gitFiles: GitFileStatus[];
  newInput: NewInputProps | null;
  rename: RenameState | null;
  onSelect: (path: string) => void;
  onSelectDir: (path: string | null) => void;
  onDelete: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  dirToggleSignal: { path: string; nonce: number } | null;
  renderNewInput: (depth: number) => React.ReactNode;
  onRenameChange: (name: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
}

function gitStatusColor(status: string): string {
  if (status === "M") return "#f78166";
  if (status === "A") return "#3fb950";
  if (status === "D") return "#ff7b72";
  return "#8b949e";
}

function FileNode({
  entry,
  depth,
  selectedPath,
  selectedDir,
  forceExpanded,
  gitFiles,
  newInput,
  rename,
  onSelect,
  onSelectDir,
  onDelete,
  onContextMenu,
  dirToggleSignal,
  renderNewInput,
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
}: FileNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedPath === entry.path;
  const isDirSelected = selectedDir === entry.path;
  const showInputHere = newInput && newInput.parentDir === entry.path;
  const isRenameTarget = rename?.target.path === entry.path;

  const gitEntry = entry.is_dir
    ? gitFiles.find((f) => f.path.startsWith(entry.path + "/"))
    : gitFiles.find((f) => f.path === entry.path);

  useEffect(() => {
    if (forceExpanded !== null) setExpanded(forceExpanded);
  }, [forceExpanded]);

  useEffect(() => {
    if (showInputHere) setExpanded(true);
  }, [showInputHere]);

  useEffect(() => {
    if (!dirToggleSignal) return;
    if (dirToggleSignal.path !== entry.path) return;
    setExpanded((prev) => !prev);
  }, [dirToggleSignal?.nonce, dirToggleSignal?.path, entry.path]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isRenameTarget) return;
    if (entry.is_dir) {
      setExpanded((prev) => !prev);
      onSelectDir(isDirSelected ? null : entry.path);
    } else {
      onSelect(entry.path);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirm(`「${entry.name}」を削除しますか？`, { title: "削除確認", kind: "warning" });
    if (ok) onDelete(entry.path);
  };

  return (
    <div>
      <div
        className={`file-node ${isSelected ? "selected" : ""} ${isDirSelected ? "dir-selected" : ""} ${entry.is_dir ? "dir" : "file"}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onContextMenu={(e) => onContextMenu(e, entry)}
      >
        <span className="file-icon">
          {entry.is_dir ? (expanded ? "▾" : "▸") : "○"}
        </span>
        {isRenameTarget ? (
          <input
            className="rename-inline-input"
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={rename!.name}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); onRenameConfirm(); }
              if (e.key === "Escape") onRenameCancel();
            }}
            onBlur={onRenameCancel}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="file-name">{entry.name}</span>
        )}
        {gitEntry && (
          <span
            className="git-status-dot"
            style={{ color: gitStatusColor(gitEntry.status) }}
            title={gitEntry.staged ? `staged: ${gitEntry.status}` : `unstaged: ${gitEntry.status}`}
          >
            {gitEntry.status}
          </span>
        )}
        {!entry.is_dir && !isRenameTarget && (
          <button className="file-action-btn" onClick={handleDelete} title="削除">
            ✕
          </button>
        )}
      </div>
      {entry.is_dir && expanded && (
        <>
          {showInputHere && renderNewInput(depth + 1)}
          {entry.children?.map((child) => (
            <FileNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              selectedDir={selectedDir}
              forceExpanded={forceExpanded}
              gitFiles={gitFiles}
              newInput={newInput}
              rename={rename}
              onSelect={onSelect}
              onSelectDir={onSelectDir}
              onDelete={onDelete}
              onContextMenu={onContextMenu}
              dirToggleSignal={dirToggleSignal}
              renderNewInput={renderNewInput}
              onRenameChange={onRenameChange}
              onRenameConfirm={onRenameConfirm}
              onRenameCancel={onRenameCancel}
            />
          ))}
        </>
      )}
    </div>
  );
}

export function FileTree({ files, selectedPath, forceExpanded, vaultName, vaultPath, gitFiles, onSelect, onCreate, onCreateDir, onDelete, onRename }: FileTreeProps) {
  const [newName, setNewName] = useState("");
  const [newInput, setNewInput] = useState<NewInputProps | null>(null);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [rename, setRename] = useState<RenameState | null>(null);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: FileEntry } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
  const [dirToggleSignal, setDirToggleSignal] = useState<{ path: string; nonce: number } | null>(null);

  const requestToggleDir = useCallback((path: string) => {
    setDirToggleSignal({ path, nonce: Date.now() + Math.random() });
  }, []);

  const getParentDir = useCallback((path: string): string | null => {
    const normalized = path.replace(/^\/+/, "");
    const idx = normalized.lastIndexOf("/");
    return idx >= 0 ? normalized.slice(0, idx) : null;
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const onMouseDown = (ev: MouseEvent) => {
      const el = contextMenuRef.current;
      if (!el) return;
      const target = ev.target;
      if (target instanceof Node && el.contains(target)) return;
      setContextMenu(null);
    };
    window.addEventListener("mousedown", onMouseDown);
    return () => window.removeEventListener("mousedown", onMouseDown);
  }, [contextMenu]);

  const handleCreate = useCallback(() => {
    if (!newName.trim() || !newInput) return;
    const basePath = newInput.parentDir ? `${newInput.parentDir}/` : "";
    if (newInput.mode === "file") {
      const name = newName.endsWith(".md") ? newName : `${newName}.md`;
      onCreate(`${basePath}${name}`);
    } else {
      onCreateDir(`${basePath}${newName.trim()}`);
    }
    setNewName("");
    setNewInput(null);
  }, [newName, newInput, onCreate, onCreateDir]);

  // parentDirOverride が undefined のときだけ selectedDir にフォールバック
  const openCreateInput = (mode: CreateMode, parentDirOverride?: string | null) => {
    const parentDir = parentDirOverride !== undefined ? parentDirOverride : selectedDir;
    setNewInput({ parentDir, mode });
    setNewName("");
    setRename(null);
    setContextMenu(null);
  };

  const closeInput = useCallback(() => {
    setNewInput(null);
    setNewName("");
  }, []);

  // メニューバーの "New Note" から開く
  useEffect(() => {
    const handler = () => openCreateInput("file");
    window.addEventListener("nomos:new-note", handler);
    return () => window.removeEventListener("nomos:new-note", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDir]);

  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(240);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.classList.add("resizing");

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const next = Math.max(160, Math.min(480, startWidth.current + e.clientX - startX.current));
      setWidth(next);
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.body.classList.remove("resizing");
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  const handleCopyVaultPath = () => {
    navigator.clipboard.writeText(vaultPath).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const renderNewInput = useCallback((depth: number) => (
    <div
      className="new-file-input inline"
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
    >
      <span className="file-icon">{newInput?.mode === "dir" ? "▸" : "○"}</span>
      <input
        autoFocus
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleCreate();
          if (e.key === "Escape") closeInput();
        }}
        onBlur={closeInput}
        placeholder={newInput?.mode === "file" ? "ファイル名.md" : "フォルダ名"}
      />
    </div>
  ), [newName, newInput, handleCreate, closeInput]);

  const showRootInput = newInput && newInput.parentDir === null;

  // リネーム確定
  const handleRenameConfirm = useCallback(async () => {
    if (!rename) return;
    const trimmed = rename.name.trim();
    if (!trimmed) { setRename(null); return; }

    const parentDir = getParentDir(rename.target.path);
    const base = parentDir ? `${parentDir}/` : "";
    let newPath: string;
    if (rename.target.is_dir) {
      newPath = `${base}${trimmed}`;
    } else {
      const name = trimmed.endsWith(".md") ? trimmed : `${trimmed}.md`;
      newPath = `${base}${name}`;
    }
    if (newPath === rename.target.path) { setRename(null); return; }
    await onRename(rename.target.path, newPath);
    setRename(null);
  }, [rename, getParentDir, onRename]);

  const handleRenameCancel = useCallback(() => setRename(null), []);

  const handleContextMenu = (e: React.MouseEvent, target: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, target });
  };

  const handleOpenFromMenu = async (target: FileEntry) => {
    if (target.is_dir) {
      requestToggleDir(target.path);
      setSelectedDir(selectedDir === target.path ? null : target.path);
    } else {
      onSelect(target.path);
    }
    setContextMenu(null);
  };

  const handleRenameFromMenu = (target: FileEntry) => {
    setNewInput(null);
    setNewName("");
    setRename({ target, name: target.name });
    setContextMenu(null);
  };

  const handleNewFromMenu = (mode: CreateMode, target: FileEntry) => {
    const parentDirForCreate = target.is_dir ? target.path : getParentDir(target.path);
    openCreateInput(mode, parentDirForCreate);
  };

  const handleDeleteFromMenu = async (target: FileEntry) => {
    setContextMenu(null);
    const ok = await confirm(`「${target.name}」を削除しますか？`, { title: "削除確認", kind: "warning" });
    if (ok) onDelete(target.path);
  };

  return (
    <aside className="file-tree" style={{ width, minWidth: width }}>
      <div className="file-tree-resize-handle" onMouseDown={handleResizeStart} />
      {copied && <div className="copy-flash">コピーしました</div>}
      <div className="file-tree-header">
        <span
          className="file-tree-title"
          onClick={handleCopyVaultPath}
          title={vaultPath}
        >
          {vaultName || "Files"}
        </span>
        <div>
          <button className="file-tree-new-btn" onClick={() => openCreateInput("file")} title="新規ノート">＋</button>
          <button className="file-tree-new-btn" onClick={() => openCreateInput("dir")} title="新規フォルダ">📁</button>
        </div>
      </div>

      <div className="file-tree-list">
        {showRootInput && renderNewInput(0)}
        {files.map((entry) => (
          <FileNode
            key={entry.path}
            entry={entry}
            depth={0}
            selectedPath={selectedPath}
            selectedDir={selectedDir}
            forceExpanded={forceExpanded}
            gitFiles={gitFiles}
            newInput={newInput}
            rename={rename}
            onSelect={onSelect}
            onSelectDir={setSelectedDir}
            onDelete={onDelete}
            onContextMenu={handleContextMenu}
            dirToggleSignal={dirToggleSignal}
            renderNewInput={renderNewInput}
            onRenameChange={(name) => setRename((prev) => prev ? { ...prev, name } : null)}
            onRenameConfirm={handleRenameConfirm}
            onRenameCancel={handleRenameCancel}
          />
        ))}
        {files.length === 0 && !showRootInput && (
          <div className="file-tree-empty">ノートがありません</div>
        )}
      </div>

      {contextMenu && (
        <div
          className="tab-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          ref={contextMenuRef}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button className="tab-context-menu-item" onClick={() => void handleOpenFromMenu(contextMenu.target)}>
            開く
          </button>
          <div className="tab-context-menu-separator" />
          <button className="tab-context-menu-item" onClick={() => handleNewFromMenu("file", contextMenu.target)}>
            新規ノート
          </button>
          <button className="tab-context-menu-item" onClick={() => handleNewFromMenu("dir", contextMenu.target)}>
            新規フォルダ
          </button>
          <div className="tab-context-menu-separator" />
          <button className="tab-context-menu-item" onClick={() => handleRenameFromMenu(contextMenu.target)}>
            リネーム
          </button>
          <button className="tab-context-menu-item" onClick={() => void handleDeleteFromMenu(contextMenu.target)}>
            削除
          </button>
          <div className="tab-context-menu-separator" />
          <button
            className="tab-context-menu-item"
            onClick={() => { handleCopyPath(contextMenu.target.path); setContextMenu(null); }}
          >
            プロパティ
          </button>
        </div>
      )}
    </aside>
  );
}
