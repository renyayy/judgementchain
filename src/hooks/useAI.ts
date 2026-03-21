import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { notify } from "../lib/notifications";

export type ModelStatus = "idle" | "loading" | "ready" | "error";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

export function useAI() {
  const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // llm-token イベントをリッスン（マウント時）
  useEffect(() => {
    let cleanup = false;
    listen<string>("llm-token", (e) => {
      if (cleanup) return;
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== "assistant") return prev;
        return [
          ...prev.slice(0, -1),
          { role: "assistant", content: last.content + e.payload },
        ];
      });
    }).then((fn) => {
      if (cleanup) fn();
      else unlistenRef.current = fn;
    });
    return () => {
      cleanup = true;
      unlistenRef.current?.();
    };
  }, []);

  const loadModel = useCallback(async (forceReload: boolean = false) => {
    if (modelStatus === "loading") return;
    if (!forceReload && modelStatus === "ready") return;
    setModelStatus("loading");
    try {
      await invoke("load_model");
      setModelStatus("ready");
    } catch (e) {
      console.error("load_model error:", e);
      setModelStatus("error");
      notify(`モデルの読み込みに失敗しました: ${e}`, "error");
    }
  }, [modelStatus]);

  const generateText = useCallback(
    async (prompt: string, maxTokens = 512) => {
      if (isGenerating || modelStatus !== "ready") return;

      // ユーザーメッセージを追加
      setMessages((prev) => [
        ...prev,
        { role: "user", content: prompt },
        { role: "assistant", content: "" },
      ]);
      setIsGenerating(true);

      try {
        // Gemma instruct フォーマットに整形
        const formatted =
          `<start_of_turn>user\n${prompt}<end_of_turn>\n<start_of_turn>model\n`;
        await invoke<string>("generate_text", {
          prompt: formatted,
          maxTokens,
        });
      } catch (e) {
        console.error("generate_text error:", e);
        notify(`テキスト生成に失敗しました: ${e}`, "error");
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== "assistant") return prev;
          return [
            ...prev.slice(0, -1),
            { role: "assistant", content: "[エラーが発生しました]" },
          ];
        });
      } finally {
        setIsGenerating(false);
      }
    },
    [isGenerating, modelStatus]
  );

  const clearMessages = useCallback(() => setMessages([]), []);

  return { modelStatus, messages, isGenerating, loadModel, generateText, clearMessages };
}
