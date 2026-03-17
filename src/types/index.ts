export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
}

export interface NoteContent {
  content: string;
  path: string;
}

export interface MarginAnnotation {
  id: string;
  annotation_type: string;
  icon: string;
  title: string;
  content: string;
  link?: string;
}

export interface Backlink {
  source: string;
  text: string;
}

export interface Config {
  vault?: {
    path: string;
  };
  git?: {
    enabled: boolean;
  };
}

export type EditorTabType = "file" | "diff" | "commit";

export interface EditorTab {
  id: string;
  path: string;
  tabType: EditorTabType;
  content: string;
  savedContent: string;
  isDirty: boolean;
  rawDiff?: string;
  annotations: MarginAnnotation[];
  backlinks: Backlink[];
}

export interface GitFileStatus {
  path: string;
  status: string; // M, A, D, ?, R
  staged: boolean;
}

export interface GitStatus {
  is_repo: boolean;
  branch: string;
  files: GitFileStatus[];
}

export interface GitCommit {
  hash: string;
  short_hash: string;
  parents: string[];
  message: string;
  timestamp: number;
  refs: string;
}
