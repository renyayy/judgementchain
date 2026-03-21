import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { notify } from "../lib/notifications";
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
      notify(`ファイル一覧の取得に失敗しました: ${e}`, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  const openFile = useCallback(async (path: string): Promise<NoteContent | null> => {
    try {
      return await invoke<NoteContent>("open_file", { path });
    } catch (e) {
      notify(`ファイルを開けませんでした: ${e}`, "error");
      return null;
    }
  }, []);

  const saveFile = useCallback(async (path: string, content: string): Promise<boolean> => {
    try {
      return await invoke<boolean>("save_file", { path, content });
    } catch (e) {
      notify(`保存に失敗しました: ${e}`, "error");
      return false;
    }
  }, []);

  const createFile = useCallback(async (path: string): Promise<boolean> => {
    try {
      const ok = await invoke<boolean>("create_file", { path, content: null });
      if (ok) await listFiles();
      return ok;
    } catch (e) {
      notify(`ファイルの作成に失敗しました: ${e}`, "error");
      return false;
    }
  }, [listFiles]);

  const createDir = useCallback(async (path: string): Promise<boolean> => {
    try {
      const ok = await invoke<boolean>("create_dir", { path });
      if (ok) await listFiles();
      return ok;
    } catch (e) {
      notify(`フォルダの作成に失敗しました: ${e}`, "error");
      return false;
    }
  }, [listFiles]);

  const deleteFile = useCallback(async (path: string): Promise<boolean> => {
    try {
      const ok = await invoke<boolean>("delete_file", { path });
      if (ok) await listFiles();
      return ok;
    } catch (e) {
      notify(`削除に失敗しました: ${e}`, "error");
      return false;
    }
  }, [listFiles]);

  const renameFile = useCallback(async (oldPath: string, newPath: string): Promise<boolean> => {
    try {
      const ok = await invoke<boolean>("rename_file", { oldPath, newPath });
      if (ok) await listFiles();
      return ok;
    } catch (e) {
      notify(`リネームに失敗しました: ${e}`, "error");
      return false;
    }
  }, [listFiles]);

  const getMarginAnnotations = useCallback(async (path: string): Promise<MarginAnnotation[]> => {
    try {
      return await invoke<MarginAnnotation[]>("get_similar_notes_for_margin", { path });
    } catch (e) {
      notify(`マージン注釈の取得に失敗しました: ${e}`, "warning");
      return [];
    }
  }, []);

  const getBacklinks = useCallback(async (path: string): Promise<Backlink[]> => {
    try {
      const result = await invoke<{ links: Backlink[] }>("get_backlinks", { path });
      return result.links;
    } catch (e) {
      notify(`バックリンクの取得に失敗しました: ${e}`, "warning");
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
    renameFile,
    getMarginAnnotations,
    getBacklinks,
  };
}
