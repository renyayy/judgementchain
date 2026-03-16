import { useState, useCallback } from "react";
import type { FileEntry } from "../types";

interface FileTreeProps {
  files: FileEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onCreate: (path: string) => void;
  onDelete: (path: string) => void;
  onRefresh: () => void;
}

interface FileNodeProps {
  entry: FileEntry;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
}

function FileNode({ entry, depth, selectedPath, onSelect, onDelete }: FileNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const isSelected = selectedPath === entry.path;

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
          <button
            className="file-action-btn"
            onClick={handleDelete}
            title="削除"
          >
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
          onSelect={onSelect}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}

export function FileTree({ files, selectedPath, onSelect, onCreate, onDelete, onRefresh }: FileTreeProps) {
  const [newFileName, setNewFileName] = useState("");
  const [showNewInput, setShowNewInput] = useState(false);

  const handleCreate = useCallback(() => {
    if (!newFileName.trim()) return;
    const name = newFileName.endsWith(".md") ? newFileName : `${newFileName}.md`;
    onCreate(name);
    setNewFileName("");
    setShowNewInput(false);
  }, [newFileName, onCreate]);

  return (
    <aside className="file-tree">
      <div className="file-tree-header">
        <span className="file-tree-title">ファイル</span>
        <div className="file-tree-actions">
          <button onClick={() => setShowNewInput(true)} title="新規ノート">＋</button>
          <button onClick={onRefresh} title="更新">↺</button>
        </div>
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
