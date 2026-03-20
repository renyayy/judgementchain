import { useCallback, useEffect, useRef, useState } from "react";
import { useNotifications } from "../hooks/useNotifications";
import type { Notification, NotificationType } from "../lib/notifications";

const ICON: Record<NotificationType, string> = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  error: "✕",
};

const ACCENT: Record<NotificationType, string> = {
  info: "#4d9ef5",
  success: "#4ec94e",
  warning: "#e8b44a",
  error: "#e05252",
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      style={{
        background: "none",
        border: "none",
        color: copied ? "#4ec94e" : "var(--text-muted)",
        cursor: "pointer",
        fontSize: 11,
        lineHeight: "18px",
        padding: 0,
        flexShrink: 0,
        transition: "color 0.15s",
      }}
      aria-label="コピー"
      title="エラー文をコピー"
    >
      {copied ? "✓" : "⎘"}
    </button>
  );
}

function Toast({
  n,
  onDismiss,
}: {
  n: Notification;
  onDismiss: (id: string) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (n.duration > 0) {
      timerRef.current = setTimeout(() => onDismiss(n.id), n.duration);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [n.id, n.duration, onDismiss]);

  const accent = ACCENT[n.type];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        background: "var(--bg-secondary)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 4,
        padding: "9px 10px 9px 12px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        minWidth: 260,
        maxWidth: 380,
        animation: "toast-in 0.15s ease",
      }}
    >
      <span style={{ color: accent, fontSize: 13, lineHeight: "18px", flexShrink: 0 }}>
        {ICON[n.type]}
      </span>
      <span
        style={{
          flex: 1,
          fontSize: 12,
          color: "var(--text-primary)",
          lineHeight: 1.5,
          wordBreak: "break-word",
          userSelect: "text",
          cursor: "text",
        }}
      >
        {n.message}
      </span>
      {(n.type === "error" || n.type === "warning") && (
        <CopyButton text={n.message} />
      )}
      <button
        onClick={() => onDismiss(n.id)}
        style={{
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 13,
          lineHeight: "18px",
          padding: 0,
          flexShrink: 0,
        }}
        aria-label="閉じる"
      >
        ×
      </button>
    </div>
  );
}

export function NotificationContainer() {
  const { notifications, visibleNotifications, hiddenIds, dismiss, clearAll } = useNotifications();
  const [showHistory, setShowHistory] = useState(false);

  const getCreatedAtLabel = useCallback((id: string) => {
    // idは `${Date.now()}-${random}` の形式
    const ms = Number(id.split("-")[0]);
    if (!Number.isFinite(ms) || ms <= 0) return "";
    const d = new Date(ms);
    // ローカル時刻で簡易表示
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, []);

  if (notifications.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          zIndex: 2000,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "6px 8px",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-muted)", userSelect: "none" }}>
            通知 {notifications.length}
          </span>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              onClick={() => setShowHistory((v) => !v)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                padding: 0,
              }}
              aria-label="履歴"
              title="履歴"
            >
              {showHistory ? "閉じる" : "履歴"}
            </button>
            <button
              onClick={() => clearAll()}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                padding: 0,
              }}
              aria-label="delete all"
              title="delete all"
            >
              delete all
            </button>
          </div>
        </div>

        {showHistory && (
          <div
            style={{
              background: "var(--bg-secondary)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: 8,
              width: 420,
              maxWidth: "calc(100vw - 48px)",
              maxHeight: 300,
              overflow: "auto",
              boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
            }}
          >
            {notifications.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>通知履歴なし</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {notifications
                  .slice()
                  .reverse()
                  .map((n) => {
                    const accent = ACCENT[n.type];
                    const isHidden = hiddenIds.includes(n.id);
                    return (
                      <div
                        key={n.id}
                        style={{
                          display: "flex",
                          gap: 10,
                          alignItems: "flex-start",
                          opacity: isHidden ? 0.45 : 1,
                          padding: "6px 6px 6px 10px",
                          borderRadius: 4,
                          borderLeft: `3px solid ${accent}`,
                          background: "var(--bg-primary)",
                        }}
                      >
                        <span style={{ color: accent, fontSize: 13, lineHeight: "18px", flexShrink: 0 }}>
                          {ICON[n.type]}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 11,
                              color: "var(--text-muted)",
                              userSelect: "none",
                              marginBottom: 2,
                            }}
                          >
                            {getCreatedAtLabel(n.id)}
                            {isHidden ? " (表示外)" : ""}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--text-primary)",
                              lineHeight: 1.5,
                              wordBreak: "break-word",
                              userSelect: "text",
                            }}
                          >
                            {n.message}
                          </div>
                        </div>
                        <button
                          onClick={() => dismiss(n.id)}
                          style={{
                            background: "none",
                            border: "none",
                            color: "var(--text-muted)",
                            cursor: "pointer",
                            fontSize: 12,
                            padding: 0,
                            flexShrink: 0,
                          }}
                          aria-label="この通知を表示外にする"
                          title="この通知を表示外にする"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {visibleNotifications.map((n) => (
          <Toast key={n.id} n={n} onDismiss={dismiss} />
        ))}
      </div>
    </>
  );
}
