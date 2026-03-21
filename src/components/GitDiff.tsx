import { useState } from "react";

// ---- diff line helpers ----------------------------------------------------

export function diffLineClass(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) return "git-diff-add";
  if (line.startsWith("-") && !line.startsWith("---")) return "git-diff-del";
  if (line.startsWith("@@")) return "git-diff-hunk";
  if (
    line.startsWith("diff ") || line.startsWith("index ") ||
    line.startsWith("---") || line.startsWith("+++") ||
    line.startsWith("new file") || line.startsWith("deleted file")
  ) return "git-diff-meta";
  return "git-diff-ctx";
}

// ---- file-level accordion -------------------------------------------------

export interface FileDiff {
  filename: string;
  lines: string[];
}

export function parseFileDiffs(lines: string[]): FileDiff[] {
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

export function FileDiffSection({ file }: { file: FileDiff }) {
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

// ---- DiffView (file changes) ----------------------------------------------

export function DiffView({ content }: { path: string; content: string }) {
  const fileDiffs = parseFileDiffs(content.split("\n"));
  const isSynthetic = !content.includes("diff --git");

  return (
    <div className="git-diff-view standalone">
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

// ---- CommitDetail ---------------------------------------------------------

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
  i++;

  const msgLines: string[] = [];
  while (i < lines.length && lines[i] !== "") {
    msgLines.push(lines[i].replace(/^ {4}/, ""));
    i++;
  }
  const message = msgLines.join("\n").trim();
  i++;

  const statLines: string[] = [];
  while (i < lines.length && !lines[i].startsWith("diff --git")) {
    if (lines[i].trim()) statLines.push(lines[i]);
    i++;
  }
  return { hash, author, date, message, statLines, diffLines: lines.slice(i) };
}

function StatLine({ line }: { line: string }) {
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

export function CommitDetail({ raw }: { raw: string }) {
  const { hash, author, date, message, statLines, diffLines } = parseCommitShow(raw);

  return (
    <div className="git-diff-view standalone">
      <div className="git-diff-body">
        <div className="git-commit-card">
          <div className="git-commit-card-msg">{message || "(no message)"}</div>
          <div className="git-commit-card-meta">
            <span className="git-commit-card-author">{author}</span>
            <span className="git-commit-card-date">{date}</span>
          </div>
          <div className="git-commit-card-hash">{hash}</div>
        </div>

        {statLines.length > 0 && (
          <div className="git-stat-block">
            {statLines.map((l, i) => <StatLine key={i} line={l} />)}
          </div>
        )}

        {parseFileDiffs(diffLines).map((f, i) => (
          <FileDiffSection key={i} file={f} />
        ))}
      </div>
    </div>
  );
}
