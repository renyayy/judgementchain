import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GitStatus, GitCommit } from "../types";

// ---- Graph layout --------------------------------------------------------

const LANE_COLORS = ["#58a6ff", "#3fb950", "#f78166", "#d2a8ff", "#ffa657", "#ff7b72", "#79c0ff"];
const LANE_W = 14;
const ROW_H = 22;

interface GraphRow {
  commit: GitCommit;
  lane: number;
  color: string;
  activeBefore: (string | null)[];
  activeAfter: (string | null)[];
  mergeTargets: number[]; // lanes that this commit merges FROM
}

function computeGraph(commits: GitCommit[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    const activeBefore = [...lanes];

    let lane = lanes.indexOf(commit.hash);
    if (lane === -1) {
      const free = lanes.indexOf(null);
      lane = free !== -1 ? free : lanes.length;
      if (free !== -1) lanes[free] = commit.hash;
      else lanes.push(commit.hash);
    }
    const color = LANE_COLORS[lane % LANE_COLORS.length];

    // Replace this lane with first parent
    lanes[lane] = commit.parents[0] ?? null;

    // Additional parents (merges) go to new lanes
    const mergeTargets: number[] = [];
    for (let p = 1; p < commit.parents.length; p++) {
      const ph = commit.parents[p];
      if (!lanes.includes(ph)) {
        const free = lanes.indexOf(null);
        const tl = free !== -1 ? free : lanes.length;
        if (free !== -1) lanes[free] = ph;
        else lanes.push(ph);
        mergeTargets.push(tl);
      } else {
        mergeTargets.push(lanes.indexOf(ph));
      }
    }

    // Trim trailing nulls
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();

    const activeAfter = [...lanes];
    rows.push({ commit, lane, color, activeBefore, activeAfter, mergeTargets });
  }
  return rows;
}

function GraphCell({ row }: { row: GraphRow }) {
  const numLanes = Math.max(row.activeBefore.length, row.activeAfter.length, row.lane + 1);
  const width = numLanes * LANE_W + 4;

  return (
    <svg width={width} height={ROW_H} style={{ display: "block", flexShrink: 0 }}>
      {/* Vertical pass-through lines */}
      {Array.from({ length: numLanes }, (_, i) => {
        if (i === row.lane) return null;
        const hasBefore = i < row.activeBefore.length && row.activeBefore[i] !== null;
        const hasAfter = i < row.activeAfter.length && row.activeAfter[i] !== null;
        if (!hasBefore && !hasAfter) return null;
        const x = i * LANE_W + 7;
        const c = LANE_COLORS[i % LANE_COLORS.length];
        return <line key={i} x1={x} y1={0} x2={x} y2={ROW_H} stroke={c} strokeWidth={1.5} />;
      })}

      {/* Line from top to commit circle */}
      {row.activeBefore[row.lane] === row.commit.hash && (
        <line x1={row.lane * LANE_W + 7} y1={0} x2={row.lane * LANE_W + 7} y2={ROW_H / 2} stroke={row.color} strokeWidth={1.5} />
      )}

      {/* Line from commit circle to bottom (first parent) */}
      {row.commit.parents.length > 0 && (
        <line x1={row.lane * LANE_W + 7} y1={ROW_H / 2} x2={row.lane * LANE_W + 7} y2={ROW_H} stroke={row.color} strokeWidth={1.5} />
      )}

      {/* Merge connection lines */}
      {row.mergeTargets.map((tl, i) => {
        const x1 = row.lane * LANE_W + 7;
        const x2 = tl * LANE_W + 7;
        const y1 = ROW_H / 2;
        const y2 = ROW_H;
        return (
          <path
            key={i}
            d={`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`}
            fill="none"
            stroke={LANE_COLORS[tl % LANE_COLORS.length]}
            strokeWidth={1.5}
          />
        );
      })}

      {/* Commit circle */}
      <circle
        cx={row.lane * LANE_W + 7}
        cy={ROW_H / 2}
        r={3.5}
        fill={row.color}
        stroke="#0d1117"
        strokeWidth={1}
      />
    </svg>
  );
}

// ---- Ref badges -----------------------------------------------------------

function RefBadges({ refs }: { refs: string }) {
  if (!refs.trim()) return null;
  const parts = refs.split(",").map((r) => r.trim()).filter(Boolean);
  return (
    <>
      {parts.map((r, i) => {
        const isHead = r.startsWith("HEAD");
        const isBranch = !r.startsWith("tag:");
        return (
          <span
            key={i}
            className={`git-ref ${isHead ? "git-ref-head" : isBranch ? "git-ref-branch" : "git-ref-tag"}`}
          >
            {r.replace("HEAD -> ", "").replace("tag: ", "")}
          </span>
        );
      })}
    </>
  );
}

// ---- Commit detail --------------------------------------------------------

interface ParsedCommit {
  hash: string;
  author: string;
  date: string;
  message: string;
  statLines: string[];
  diffLines: string[];
}

function parseCommitShow(raw: string): ParsedCommit {
  const lines = raw.split("\n");
  let i = 0;
  let hash = "", author = "", date = "";

  if (lines[i]?.startsWith("commit ")) { hash = lines[i].slice(7).trim(); i++; }
  while (i < lines.length && lines[i] !== "") {
    if (lines[i].startsWith("Author:")) author = lines[i].replace("Author:", "").trim();
    else if (lines[i].startsWith("Date:"))  date   = lines[i].replace("Date:", "").trim();
    i++;
  }
  i++; // blank line after header

  // commit message (indented 4 spaces)
  const msgLines: string[] = [];
  while (i < lines.length && lines[i] !== "") {
    msgLines.push(lines[i].replace(/^ {4}/, ""));
    i++;
  }
  const message = msgLines.join("\n").trim();
  i++; // blank line after message

  // stat lines come before "diff --git"
  const statLines: string[] = [];
  while (i < lines.length && !lines[i].startsWith("diff --git")) {
    if (lines[i].trim()) statLines.push(lines[i]);
    i++;
  }

  const diffLines = lines.slice(i);
  return { hash, author, date, message, statLines, diffLines };
}

function StatLine({ line }: { line: string }) {
  // "src/foo.ts | 12 +++---"  →  name | bar
  const match = line.match(/^(.+?)\s*\|\s*(\d+)\s*([+\-]*)$/);
  if (!match) return <div className="git-stat-other">{line}</div>;
  const [, name, count, signs] = match;
  const adds = (signs.match(/\+/g) ?? []).length;
  const dels = (signs.match(/-/g) ?? []).length;
  const total = adds + dels || 1;
  return (
    <div className="git-stat-row">
      <span className="git-stat-name">{name.trim()}</span>
      <span className="git-stat-count">{count}</span>
      <span className="git-stat-bar">
        {adds > 0 && <span className="git-stat-add" style={{ width: `${(adds / total) * 80}px` }} />}
        {dels > 0 && <span className="git-stat-del" style={{ width: `${(dels / total) * 80}px` }} />}
      </span>
    </div>
  );
}

function CommitDetail({ raw, onClose }: { raw: string; onClose: () => void }) {
  const { hash, author, date, message, statLines, diffLines } = parseCommitShow(raw);
  const shortHash = hash.slice(0, 8);

  return (
    <div className="git-diff-view">
      <div className="git-diff-header">
        <span className="git-diff-path" title={hash}>{shortHash}</span>
        <button className="git-icon-btn" onClick={onClose} title="閉じる">✕</button>
      </div>
      <div className="git-diff-body">
        {/* メタ情報 */}
        <div className="git-commit-card">
          <div className="git-commit-card-msg">{message || "(no message)"}</div>
          <div className="git-commit-card-meta">
            <span className="git-commit-card-author">{author}</span>
            <span className="git-commit-card-date">{date}</span>
          </div>
          <div className="git-commit-card-hash">{hash}</div>
        </div>

        {/* 変更ファイル統計 */}
        {statLines.length > 0 && (
          <div className="git-stat-block">
            {statLines.map((l, i) => <StatLine key={i} line={l} />)}
          </div>
        )}

        {/* diff 本体（ファイルごとにアコーディオン） */}
        {parseFileDiffs(diffLines).map((f, i) => (
          <FileDiffSection key={i} file={f} />
        ))}
      </div>
    </div>
  );
}

// ---- Main component -------------------------------------------------------

interface GitPanelProps {
  status: GitStatus;
  commits: GitCommit[];
  onRefresh: () => void;
  onStage: (path: string) => void;
  onUnstage: (path: string) => void;
  onCommit: (message: string) => void;
  onInit: () => void;
}

// ---- Diff viewer ----------------------------------------------------------

function diffLineClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "git-diff-add";
  if (line.startsWith("-") && !line.startsWith("---")) return "git-diff-del";
  if (line.startsWith("@@")) return "git-diff-hunk";
  if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++") || line.startsWith("new file") || line.startsWith("deleted file")) return "git-diff-meta";
  return "git-diff-ctx";
}

interface FileDiff {
  filename: string;
  lines: string[];
}

function parseFileDiffs(lines: string[]): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      if (current) files.push(current);
      const m = line.match(/diff --git a\/.+ b\/(.+)/);
      current = { filename: m ? m[1] : line, lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) files.push(current);
  return files;
}

function FileDiffSection({ file }: { file: FileDiff }) {
  const [open, setOpen] = useState(true);
  const adds = file.lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const dels = file.lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  const shortName = file.filename.split("/").pop() ?? file.filename;

  return (
    <div className="file-diff-section">
      <div className="file-diff-toggle-row" onClick={() => setOpen((v) => !v)}>
        <span className="file-diff-chevron">{open ? "▾" : "▸"}</span>
        <span className="file-diff-filename" title={file.filename}>{shortName}</span>
        {adds > 0 && <span className="file-diff-adds">+{adds}</span>}
        {dels > 0 && <span className="file-diff-dels">-{dels}</span>}
      </div>
      {open && (
        <div className="file-diff-body">
          {file.lines.map((line, i) => (
            <div key={i} className={`git-diff-line ${diffLineClass(line)}`}>
              {line || "\u00a0"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiffView({ path, content, onClose }: { path: string; content: string; onClose: () => void }) {
  const name = path.split("/").pop() ?? path;
  const fileDiffs = parseFileDiffs(content.split("\n"));
  // synthetic diff (untracked file: starts with "+++")
  const isSynthetic = !content.includes("diff --git");

  return (
    <div className="git-diff-view">
      <div className="git-diff-header">
        <span className="git-diff-path" title={path}>{name}</span>
        <button className="git-icon-btn" onClick={onClose} title="閉じる">✕</button>
      </div>
      <div className="git-diff-body">
        {!content.trim() ? (
          <div className="git-empty">差分なし</div>
        ) : isSynthetic ? (
          content.split("\n").map((line, i) => (
            <div key={i} className={`git-diff-line ${diffLineClass(line)}`}>
              {line || "\u00a0"}
            </div>
          ))
        ) : (
          fileDiffs.map((f, i) => <FileDiffSection key={i} file={f} />)
        )}
      </div>
    </div>
  );
}

// ---- Main component -------------------------------------------------------

type Tab = "changes" | "history";

export function GitPanel({ status, commits, onRefresh, onStage, onUnstage, onCommit, onInit }: GitPanelProps) {
  const [tab, setTab] = useState<Tab>("changes");
  const [commitMsg, setCommitMsg] = useState("");
  const [activeDiff, setActiveDiff] = useState<{ path: string; content: string } | null>(null);
  const [activeCommit, setActiveCommit] = useState<{ hash: string; message: string; content: string } | null>(null);
  const [width, setWidth] = useState(240);
  const isDragging = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  useEffect(() => {
    onRefresh();
  }, []);

  const graph = computeGraph(commits);
  const staged = status.files.filter((f) => f.staged);
  const unstaged = status.files.filter((f) => !f.staged);

  const handleCommit = () => {
    if (!commitMsg.trim() || staged.length === 0) return;
    onCommit(commitMsg.trim());
    setCommitMsg("");
  };

  const handleFileClick = useCallback(async (path: string) => {
    const content = await invoke<string>("get_diff", { path }).catch(() => "");
    setActiveDiff({ path, content });
  }, []);

  const handleCommitClick = useCallback(async (hash: string, message: string) => {
    const content = await invoke<string>("git_show", { hash }).catch(() => "");
    setActiveCommit({ hash, message, content });
  }, []);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startX.current = e.clientX;
    startWidth.current = width;
    document.body.classList.add("resizing");

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const next = Math.max(180, Math.min(480, startWidth.current - (e.clientX - startX.current)));
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

  const shortPath = (p: string) => p.split("/").pop() ?? p;
  const statusColor = (s: string) => {
    if (s === "M") return "#f78166";
    if (s === "A") return "#3fb950";
    if (s === "D") return "#ff7b72";
    return "#8b949e";
  };

  return (
    <div className="git-panel" style={{ width, minWidth: width }}>
      <div className="git-panel-resize-handle" onMouseDown={handleResizeStart} />
      <div className="git-panel-header">
        <span className="git-panel-title">Git</span>
        {status.is_repo && (
          <span className="git-branch-label">⎇ {status.branch}</span>
        )}
        <button className="git-icon-btn" onClick={onRefresh} title="更新">↻</button>
      </div>

      {!status.is_repo ? (
        <div className="git-no-repo">
          <p>Git リポジトリではありません</p>
          <button className="git-init-btn" onClick={onInit}>git init</button>
        </div>
      ) : (
        <>
          <div className="git-tabs">
            <button
              className={`git-tab ${tab === "changes" ? "active" : ""}`}
              onClick={() => setTab("changes")}
            >
              変更{status.files.length > 0 && <span className="git-badge">{status.files.length}</span>}
            </button>
            <button
              className={`git-tab ${tab === "history" ? "active" : ""}`}
              onClick={() => setTab("history")}
            >
              履歴
            </button>
          </div>

          {tab === "changes" && (
            <div className="git-changes">
              {activeDiff ? (
                <DiffView
                  path={activeDiff.path}
                  content={activeDiff.content}
                  onClose={() => setActiveDiff(null)}
                />
              ) : (
                <>
              {staged.length > 0 && (
                <div className="git-section">
                  <div className="git-section-title">ステージ済み</div>
                  {staged.map((f) => (
                    <div key={f.path} className="git-file-row" onClick={() => handleFileClick(f.path)} style={{ cursor: "pointer" }}>
                      <span className="git-status-badge" style={{ color: statusColor(f.status) }}>{f.status}</span>
                      <span className="git-file-name" title={f.path}>{shortPath(f.path)}</span>
                      <button className="git-file-btn" onClick={(e) => { e.stopPropagation(); onUnstage(f.path); }} title="ステージ解除">−</button>
                    </div>
                  ))}
                </div>
              )}
              {unstaged.length > 0 && (
                <div className="git-section">
                  <div className="git-section-title">変更</div>
                  {unstaged.map((f) => (
                    <div key={f.path} className="git-file-row" onClick={() => handleFileClick(f.path)} style={{ cursor: "pointer" }}>
                      <span className="git-status-badge" style={{ color: statusColor(f.status) }}>{f.status}</span>
                      <span className="git-file-name" title={f.path}>{shortPath(f.path)}</span>
                      <button className="git-file-btn" onClick={(e) => { e.stopPropagation(); onStage(f.path); }} title="ステージ">＋</button>
                    </div>
                  ))}
                </div>
              )}
              {status.files.length === 0 && (
                <div className="git-empty">変更はありません</div>
              )}
                </>
              )}
              <div className="git-commit-area">
                <textarea
                  className="git-commit-input"
                  placeholder="コミットメッセージ"
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  rows={2}
                />
                <button
                  className="git-commit-btn"
                  onClick={handleCommit}
                  disabled={!commitMsg.trim() || staged.length === 0}
                >
                  コミット
                </button>
              </div>
            </div>
          )}

          {tab === "history" && (
            <div className="git-history">
              {activeCommit ? (
                <CommitDetail
                  raw={activeCommit.content}
                  onClose={() => setActiveCommit(null)}
                />
              ) : (
                <>
                  {graph.length === 0 && <div className="git-empty">コミット履歴なし</div>}
                  {graph.map((row) => (
                    <div
                      key={row.commit.hash}
                      className="git-graph-row"
                      title={row.commit.hash}
                      style={{ cursor: "pointer" }}
                      onClick={() => handleCommitClick(row.commit.hash, row.commit.message)}
                    >
                      <GraphCell row={row} />
                      <div className="git-graph-info">
                        <span className="git-graph-msg">{row.commit.message}</span>
                        <RefBadges refs={row.commit.refs} />
                        <span className="git-graph-hash">{row.commit.short_hash}</span>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
