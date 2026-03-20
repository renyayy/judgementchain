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
  ai?: {
    vertex_ai_service_account_path?: string;
    vertex_ai_project_id?: string;
    vertex_ai_location?: string;
    vertex_ai_model?: string;
  };
  performance?: {
    max_system_memory_fraction?: number;
  };
}

// ==================== グラフ可視化 ====================

export interface FileGraphNode {
  id: string;
  type: "file";
  label: string;
  path: string;
  keywords: string[];
  level: 1;
  group_id: string | null;
  child_ids: string[];
}

export interface GroupGraphNode {
  id: string;
  type: "group";
  label: string;
  path: null;
  keywords: string[];
  level: 2 | 3;
  group_id: string | null;
  child_ids: string[];
}

export type GraphNode = FileGraphNode | GroupGraphNode;

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type AnalysisStatus = "idle" | "analyzing" | "done" | "error";

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
