import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GitStatus, GitCommit } from "../types";

const EMPTY_STATUS: GitStatus = { is_repo: false, branch: "", files: [] };

export function useGit() {
  const [status, setStatus] = useState<GitStatus>(EMPTY_STATUS);
  const [commits, setCommits] = useState<GitCommit[]>([]);

  const refreshStatus = useCallback(async () => {
    const s = await invoke<GitStatus>("git_repo_status");
    setStatus(s);
  }, []);

  const refreshLog = useCallback(async () => {
    const log = await invoke<GitCommit[]>("git_log", { limit: 60 });
    setCommits(log);
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshLog()]);
  }, [refreshStatus, refreshLog]);

  const stage = useCallback(async (path: string) => {
    await invoke("git_stage", { filePath: path });
    await refreshStatus();
  }, [refreshStatus]);

  const unstage = useCallback(async (path: string) => {
    await invoke("git_unstage", { filePath: path });
    await refreshStatus();
  }, [refreshStatus]);

  const commit = useCallback(async (message: string) => {
    await invoke("git_commit", { message });
    await refresh();
  }, [refresh]);

  const initRepo = useCallback(async () => {
    await invoke("git_init");
    await refresh();
  }, [refresh]);

  return { status, commits, refresh, refreshStatus, stage, unstage, commit, initRepo };
}
