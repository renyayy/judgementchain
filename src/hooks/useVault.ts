import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileEntry, NoteContent, MarginAnnotation, Backlink } from "../types";

export function useVault() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const listFiles = useCallback(async (path?: string) => {
    setLoading(true);
    try {
      const result = await invoke<FileEntry[]>("list_files", { path });
      setFiles(result);
    } catch (e) {
      console.error("list_files error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const openFile = useCallback(async (path: string): Promise<NoteContent | null> => {
    try {
      return await invoke<NoteContent>("open_file", { path });
    } catch (e) {
      console.error("open_file error:", e);
      return null;
    }
  }, []);

  const saveFile = useCallback(async (path: string, content: string): Promise<boolean> => {
    try {
      return await invoke<boolean>("save_file", { path, content });
    } catch (e) {
      console.error("save_file error:", e);
      return false;
    }
  }, []);

  const createFile = useCallback(async (path: string): Promise<boolean> => {
    try {
      const ok = await invoke<boolean>("create_file", { path, content: null });
      if (ok) await listFiles();
      return ok;
    } catch (e) {
      console.error("create_file error:", e);
      return false;
    }
  }, [listFiles]);

  const createDir = useCallback(async (path: string): Promise<boolean> => {
    try {
      const ok = await invoke<boolean>("create_dir", { path });
      if (ok) await listFiles();
      return ok;
    } catch (e) {
      console.error("create_dir error:", e);
      return false;
    }
  }, [listFiles]);

  const deleteFile = useCallback(async (path: string): Promise<boolean> => {
    try {
      const ok = await invoke<boolean>("delete_file", { path });
      if (ok) await listFiles();
      return ok;
    } catch (e) {
      console.error("delete_file error:", e);
      return false;
    }
  }, [listFiles]);

  const getMarginAnnotations = useCallback(async (path: string): Promise<MarginAnnotation[]> => {
    try {
      return await invoke<MarginAnnotation[]>("get_similar_notes_for_margin", { path });
    } catch (e) {
      console.error("get_similar_notes_for_margin error:", e);
      return [];
    }
  }, []);

  const getBacklinks = useCallback(async (path: string): Promise<Backlink[]> => {
    try {
      const result = await invoke<{ links: Backlink[] }>("get_backlinks", { path });
      return result.links;
    } catch (e) {
      console.error("get_backlinks error:", e);
      return [];
    }
  }, []);

  return {
    files,
    loading,
    listFiles,
    openFile,
    saveFile,
    createFile,
    createDir,
    deleteFile,
    getMarginAnnotations,
    getBacklinks,
  };
}
