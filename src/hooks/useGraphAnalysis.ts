import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { GraphData, AnalysisStatus } from "../types";

export function useGraphAnalysis() {
  const [status, setStatus] = useState<AnalysisStatus>("idle");
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string>("");

  const analyze = useCallback(async (dirPath: string) => {
    setStatus("analyzing");
    setError("");
    setData(null);
    try {
      const result = await invoke<GraphData>("analyze_vault_for_graph", {
        dirPath,
      });
      setData(result);
      setStatus("done");
    } catch (e) {
      setError(String(e));
      setStatus("error");
    }
  }, []);

  const reset = useCallback(() => {
    setStatus("idle");
    setData(null);
    setError("");
  }, []);

  return { status, data, error, analyze, reset };
}
