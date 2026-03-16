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
  onDelete: (path: string) => void;
}

interface FileNodeProps {
  entry: FileEntry;
  depth: number;
  selectedPath: string | null;
  forceExpanded: boolean | null;
  gitFiles: GitFileStatus[];
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
}

function gitStatusColor(status: string): string {
  if (status === "M") return "#f78166";
  if (status === "A") return "#3fb950";
  if (status === "D") return "#ff7b72";
  return "#8b949e";
}

function FileNode({ entry, depth, selectedPath, forceExpanded, gitFiles, onSelect, onDelete }: FileNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isSelected = selectedPath === entry.path;

  const gitEntry = entry.is_dir
    ? gitFiles.find((f) => f.path.startsWith(entry.path + "/"))
    : gitFiles.find((f) => f.path === entry.path);

  useEffect(() => {
    if (forceExpanded !== null) {
      setExpanded(forceExpanded);
    }
  }, [forceExpanded]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (entry.is_dir) {
      setExpanded((prev) => !prev);
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
        className={`file-node ${isSelected ? "selected" : ""} ${entry.is_dir ? "dir" : "file"}`}
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
      {entry.is_dir && expanded && entry.children?.map((child) => (
        <FileNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          forceExpanded={forceExpanded}
          gitFiles={gitFiles}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

export function FileTree({ files, selectedPath, forceExpanded, vaultName, vaultPath, gitFiles, onSelect, onCreate, onDelete }: FileTreeProps) {
  const [newFileName, setNewFileName] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);

  const handleCreate = useCallback(() => {
    if (!newFileName.trim()) return;
    const name = newFileName.endsWith(".md") ? newFileName : `${newFileName}.md`;
    onCreate(name);
    setNewFileName("");
    setShowNewInput(false);
  }, [newFileName, onCreate]);

  // メニューバーの "New Note" から開く
  useEffect(() => {
    const handler = () => setShowNewInput(true);
    window.addEventListener("nomos:new-note", handler);
    return () => window.removeEventListener("nomos:new-note", handler);
  }, []);

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
        <button className="file-tree-new-btn" onClick={() => setShowNewInput(true)} title="新規ノート">＋</button>
      </div>

      {showNewInput && (
        <div className="new-file-input">
          <input
            autoFocus
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") setShowNewInput(false);
            }}
            onBlur={() => setShowNewInput(false)}
            placeholder="ファイル名.md"
          />
        </div>
      )}

      <div className="file-tree-list">
        {files.map((entry) => (
          <FileNode
            key={entry.path}
            entry={entry}
            depth={0}
            selectedPath={selectedPath}
            forceExpanded={forceExpanded}
            gitFiles={gitFiles}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        ))}
        {files.length === 0 && (
          <div className="file-tree-empty">ノートがありません</div>
        )}
      </div>
    </aside>
  );
}
