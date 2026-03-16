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
