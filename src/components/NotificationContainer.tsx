import { useEffect, useRef } from "react";
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
        }}
      >
        {n.message}
      </span>
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
  const { notifications, dismiss } = useNotifications();

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
        {notifications.map((n) => (
          <Toast key={n.id} n={n} onDismiss={dismiss} />
        ))}
      </div>
    </>
  );
}
