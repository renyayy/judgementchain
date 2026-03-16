import { useState, useEffect, useRef } from "react";
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

type Tab = "changes" | "history";

export function GitPanel({ status, commits, onRefresh, onStage, onUnstage, onCommit, onInit }: GitPanelProps) {
  const [tab, setTab] = useState<Tab>("changes");
  const [commitMsg, setCommitMsg] = useState("");
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
              {staged.length > 0 && (
                <div className="git-section">
                  <div className="git-section-title">ステージ済み</div>
                  {staged.map((f) => (
                    <div key={f.path} className="git-file-row">
                      <span className="git-status-badge" style={{ color: statusColor(f.status) }}>{f.status}</span>
                      <span className="git-file-name" title={f.path}>{shortPath(f.path)}</span>
                      <button className="git-file-btn" onClick={() => onUnstage(f.path)} title="ステージ解除">−</button>
                    </div>
                  ))}
                </div>
              )}
              {unstaged.length > 0 && (
                <div className="git-section">
                  <div className="git-section-title">変更</div>
                  {unstaged.map((f) => (
                    <div key={f.path} className="git-file-row">
                      <span className="git-status-badge" style={{ color: statusColor(f.status) }}>{f.status}</span>
                      <span className="git-file-name" title={f.path}>{shortPath(f.path)}</span>
                      <button className="git-file-btn" onClick={() => onStage(f.path)} title="ステージ">＋</button>
                    </div>
                  ))}
                </div>
              )}
              {status.files.length === 0 && (
                <div className="git-empty">変更はありません</div>
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
              {graph.length === 0 && <div className="git-empty">コミット履歴なし</div>}
              {graph.map((row) => (
                <div key={row.commit.hash} className="git-graph-row" title={row.commit.hash}>
                  <GraphCell row={row} />
                  <div className="git-graph-info">
                    <span className="git-graph-msg">{row.commit.message}</span>
                    <RefBadges refs={row.commit.refs} />
                    <span className="git-graph-hash">{row.commit.short_hash}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
