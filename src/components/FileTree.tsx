import { useState, useCallback, useEffect, useRef } from "react";
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
}

type CreateMode = "file" | "dir";

interface NewInputProps {
  parentDir: string | null;
  mode: CreateMode;
}

interface FileNodeProps {
  entry: FileEntry;
  depth: number;
  selectedPath: string | null;
  selectedDir: string | null;
  forceExpanded: boolean | null;
  gitFiles: GitFileStatus[];
  newInput: NewInputProps | null;
  onSelect: (path: string) => void;
  onSelectDir: (path: string | null) => void;
  onDelete: (path: string) => void;
  renderNewInput: (depth: number) => React.ReactNode;
}

function gitStatusColor(status: string): string {
  if (status === "M") return "#f78166";
  if (status === "A") return "#3fb950";
  if (status === "D") return "#ff7b72";
  return "#8b949e";
}

function FileNode({ entry, depth, selectedPath, selectedDir, forceExpanded, gitFiles, newInput, onSelect, onSelectDir, onDelete, renderNewInput }: FileNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedPath === entry.path;
  const isDirSelected = selectedDir === entry.path;
  const showInputHere = newInput && newInput.parentDir === entry.path;

  const gitEntry = entry.is_dir
    ? gitFiles.find((f) => f.path.startsWith(entry.path + "/"))
    : gitFiles.find((f) => f.path === entry.path);

  useEffect(() => {
    if (forceExpanded !== null) {
      setExpanded(forceExpanded);
    }
  }, [forceExpanded]);

  useEffect(() => {
    if (showInputHere) {
      setExpanded(true);
    }
  }, [showInputHere]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (entry.is_dir) {
      setExpanded((prev) => !prev);
      onSelectDir(isDirSelected ? null : entry.path);
    } else {
      onSelect(entry.path);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`「${entry.name}」を削除しますか？`)) {
      onDelete(entry.path);
    }
  };

  return (
    <div>
      <div
        className={`file-node ${isSelected ? "selected" : ""} ${isDirSelected ? "dir-selected" : ""} ${entry.is_dir ? "dir" : "file"}`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
      >
        <span className="file-icon">
          {entry.is_dir ? (expanded ? "▾" : "▸") : "○"}
        </span>
        <span className="file-name">{entry.name}</span>
        {gitEntry && (
          <span
            className="git-status-dot"
            style={{ color: gitStatusColor(gitEntry.status) }}
            title={gitEntry.staged ? `staged: ${gitEntry.status}` : `unstaged: ${gitEntry.status}`}
          >
            {gitEntry.status}
          </span>
        )}
        {!entry.is_dir && (
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
              onSelect={onSelect}
              onSelectDir={onSelectDir}
              onDelete={onDelete}
              renderNewInput={renderNewInput}
            />
          ))}
        </>
      )}
    </div>
  );
}

export function FileTree({ files, selectedPath, forceExpanded, vaultName, vaultPath, gitFiles, onSelect, onCreate, onCreateDir, onDelete }: FileTreeProps) {
  const [newName, setNewName] = useState("");
  const [newInput, setNewInput] = useState<NewInputProps | null>(null);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);

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

  const openCreateInput = (mode: CreateMode) => {
    setNewInput({ parentDir: selectedDir, mode });
    setNewName("");
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
            onSelect={onSelect}
            onSelectDir={setSelectedDir}
            onDelete={onDelete}
            renderNewInput={renderNewInput}
          />
        ))}
        {files.length === 0 && !showRootInput && (
          <div className="file-tree-empty">ノートがありません</div>
        )}
      </div>
    </aside>
  );
}
