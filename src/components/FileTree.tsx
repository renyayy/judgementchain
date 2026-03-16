import { useState, useCallback, useEffect } from "react";
import type { FileEntry } from "../types";

interface FileTreeProps {
  files: FileEntry[];
  selectedPath: string | null;
  forceExpanded: boolean | null;
  onSelect: (path: string) => void;
  onCreate: (path: string) => void;
  onDelete: (path: string) => void;
}

interface FileNodeProps {
  entry: FileEntry;
  depth: number;
  selectedPath: string | null;
  forceExpanded: boolean | null;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
}

function FileNode({ entry, depth, selectedPath, forceExpanded, onSelect, onDelete }: FileNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedPath === entry.path;

  useEffect(() => {
    if (forceExpanded !== null) {
      setExpanded(forceExpanded);
    }
  }, [forceExpanded]);

  const handleClick = () => {
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
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

export function FileTree({ files, selectedPath, forceExpanded, onSelect, onCreate, onDelete }: FileTreeProps) {
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

  return (
    <aside className="file-tree">
      <div className="file-tree-header">
        <span className="file-tree-title">Files</span>
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
