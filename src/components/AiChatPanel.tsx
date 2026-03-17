import { useState, useRef, useEffect } from "react";
import type { ModelStatus, Message } from "../hooks/useAI";

interface AiChatPanelProps {
  modelStatus: ModelStatus;
  messages: Message[];
  isGenerating: boolean;
  onLoadModel: () => void;
  onGenerate: (prompt: string) => void;
  onClear: () => void;
}

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

  // 新しいメッセージが来たら最下部にスクロール
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

      {/* モデル未ロード時のロードボタン */}
      {(modelStatus === "idle" || modelStatus === "error") && (
        <div className="ai-load-area">
          <p className="ai-load-desc">
            {modelStatus === "error"
              ? "モデルの読み込みに失敗しました。"
              : "Gemma モデルをメモリに読み込みます。"}
          </p>
          <button className="ai-load-btn" onClick={onLoadModel}>
            モデルをロード
          </button>
        </div>
      )}

      {modelStatus === "loading" && (
        <div className="ai-load-area">
          <div className="ai-loading-spinner" />
          <p className="ai-load-desc">ロード中... (数秒かかります)</p>
        </div>
      )}

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
