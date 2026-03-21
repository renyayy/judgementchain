import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ModelStatus, Message } from "../hooks/useAI";
import { notify } from "../lib/notifications";

interface AiChatPanelProps {
  modelStatus: ModelStatus;
  messages: Message[];
  isGenerating: boolean;
  onLoadModel: (forceReload?: boolean) => Promise<void>;
  onGenerate: (prompt: string) => void;
  onClear: () => void;
}

const MODEL_OPTIONS = [
  { value: "gemma-270m-gguf/gemma-3-270m-it-Q6_K.gguf", label: "Q6_K (Gemma 3 270m)" },
  { value: "gemma-270m-gguf/gemma-3-270m-it-Q4_K_M.gguf", label: "Q4_K_M (Gemma 3 270m)" },
  { value: "gemma-270m-gguf/gemma-3-270m-it-Q8_0.gguf", label: "Q8_0 (Gemma 3 270m)" },
  { value: "gemma-270m-gguf/gemma-3-270m-it-F16.gguf", label: "F16 (Gemma 3 270m)" },
  { value: "gemma-3-1b-it-q4_0.gguf", label: "q4_0 (Gemma 3 1B)" },
] as const;

type ModelPath = (typeof MODEL_OPTIONS)[number]["value"];

const DEFAULT_MODEL_VALUE: ModelPath = MODEL_OPTIONS[0].value;

const getFilename = (p: string) => {
  const trimmed = p.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] ?? "";
};

const modelValueByFilename = new Map<string, ModelPath>(
  MODEL_OPTIONS.map((o) => [getFilename(o.value), o.value]),
);

export function AiChatPanel({
  modelStatus,
  messages,
  isGenerating,
  onLoadModel,
  onGenerate,
  onClear,
}: AiChatPanelProps) {
  const [width, setWidth] = useState(320);
  const [input, setInput] = useState("");
  const startX = useRef(0);
  const startWidth = useRef(width);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [selectedModelPath, setSelectedModelPath] = useState<ModelPath>(DEFAULT_MODEL_VALUE);
  const [ignoreMemoryBudget, setIgnoreMemoryBudget] = useState(false);
  const [savingModel, setSavingModel] = useState(false);

  // 新しいメッセージが来たら最下部にスクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // 起動時に config.ai.model_path を読み、モデル選択を初期化
  useEffect(() => {
    let cancelled = false;
    invoke<Record<string, unknown>>("get_config")
      .then((cfg) => {
        if (cancelled) return;
        const ai = (cfg.ai as Record<string, unknown> | undefined) ?? undefined;
        const performance = (cfg.performance as Record<string, unknown> | undefined) ?? undefined;
        const raw = (ai?.model_path as string | undefined) ?? "";
        if (!raw.trim()) {
          setSelectedModelPath(DEFAULT_MODEL_VALUE);
          return;
        }
        const matched = modelValueByFilename.get(getFilename(raw));
        setSelectedModelPath(matched ?? DEFAULT_MODEL_VALUE);

        const rawIgnore = performance?.ignore_memory_budget as boolean | undefined;
        setIgnoreMemoryBudget(rawIgnore ?? false);
      })
      .catch((e) => {
        console.error("get_config error:", e);
        if (!cancelled) setSelectedModelPath(DEFAULT_MODEL_VALUE);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleResizeStart = (e: React.MouseEvent) => {
    startX.current = e.clientX;
    startWidth.current = width;
    const onMove = (ev: MouseEvent) => {
      const delta = startX.current - ev.clientX;
      setWidth(Math.max(240, Math.min(600, startWidth.current + delta)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleApplyModel = useCallback(async () => {
    if (savingModel) return;
    try {
      setSavingModel(true);
      const cfg = await invoke<Record<string, unknown>>("get_config");
      const ai = (cfg.ai as Record<string, unknown> | undefined) ?? {};
      const performance = (cfg.performance as Record<string, unknown> | undefined) ?? {};
      const updated = {
        ...cfg,
        performance: {
          ...performance,
          ignore_memory_budget: ignoreMemoryBudget,
        },
        ai: {
          ...ai,
          model_path: selectedModelPath,
        },
      };
      await invoke("update_config", { config: updated });
      await onLoadModel(true);
    } catch (e) {
      console.error("apply model error:", e);
      notify(`モデルの切り替えに失敗しました: ${e}`, "error");
    } finally {
      setSavingModel(false);
    }
  }, [onLoadModel, savingModel, selectedModelPath, ignoreMemoryBudget]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isGenerating || modelStatus !== "ready") return;
    onGenerate(trimmed);
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const statusLabel: Record<ModelStatus, string> = {
    idle: "未ロード",
    loading: "ロード中...",
    ready: "準備完了",
    error: "エラー",
  };

  return (
    <aside className="ai-chat-panel" style={{ width, minWidth: width }}>
      <div className="margin-panel-resize-handle" onMouseDown={handleResizeStart} />

      <div className="ai-chat-header">
        <span className="ai-chat-title">AI (Gemma)</span>
        <span className={`ai-status ai-status--${modelStatus}`}>
          {statusLabel[modelStatus]}
        </span>
        {messages.length > 0 && (
          <button className="ai-clear-btn" onClick={onClear} title="会話をクリア">
            ✕
          </button>
        )}
      </div>

      {/* モデル選択（Q6_K をデフォルト表示） */}
      <div className="ai-model-switch-area">
        <div className="ai-model-switch-row">
          <div className="ai-model-switch-label">モデル</div>
          <select
            className="ai-model-select"
            value={selectedModelPath}
            disabled={savingModel || modelStatus === "loading"}
            onChange={(e) => setSelectedModelPath(e.target.value as ModelPath)}
          >
            {MODEL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="ai-ignore-memory-row">
          <label className="ai-ignore-memory-label">
            <input
              type="checkbox"
              checked={ignoreMemoryBudget}
              disabled={savingModel || modelStatus === "loading"}
              onChange={(e) => setIgnoreMemoryBudget(e.target.checked)}
            />
            RAM上限を無視する（自己責任）
          </label>
          <p className="ai-ignore-memory-help">
            True にするとロード前チェックと `RLIMIT_AS` を無効化します。OSに kill される可能性があります。
          </p>
        </div>

        <div className="ai-model-switch-actions">
          {modelStatus === "loading" ? <div className="ai-loading-spinner" /> : <span />}
          <button
            className="ai-load-btn ai-model-apply-btn"
            disabled={savingModel || modelStatus === "loading"}
            onClick={handleApplyModel}
          >
            {modelStatus === "ready" ? "モデルを切替" : "選択したモデルでロード"}
          </button>
        </div>
        {modelStatus === "error" && (
          <p className="ai-model-help">
            モデルの読み込みに失敗しました。モデルを変更して再ロードしてください。
          </p>
        )}
        <p className="ai-model-help">
          初期値は `ai.model_path` が未設定の場合のデフォルト（現在は `Q6_K`）です。
        </p>
      </div>

      {/* メッセージ一覧 */}
      <div className="ai-messages">
        {messages.length === 0 && modelStatus === "ready" && (
          <p className="ai-empty">何でも聞いてください。</p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`ai-message ai-message--${msg.role}`}>
            <span className="ai-message-role">
              {msg.role === "user" ? "あなた" : "Gemma"}
            </span>
            <p className="ai-message-content">
              {msg.content}
              {msg.role === "assistant" && isGenerating && i === messages.length - 1 && (
                <span className="ai-cursor">▋</span>
              )}
            </p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 入力フォーム */}
      {modelStatus === "ready" && (
        <form className="ai-input-form" onSubmit={handleSubmit}>
          <textarea
            className="ai-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="質問を入力（Enter で送信 / Shift+Enter で改行）"
            disabled={isGenerating}
            rows={3}
          />
          <button
            type="submit"
            className="ai-send-btn"
            disabled={isGenerating || !input.trim()}
          >
            {isGenerating ? "生成中..." : "送信"}
          </button>
        </form>
      )}
    </aside>
  );
}
