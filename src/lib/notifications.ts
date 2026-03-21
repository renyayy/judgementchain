export type NotificationType = "info" | "success" | "warning" | "error";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  /** ms。0 = 手動で閉じるまで残る */
  duration: number;
}

type Listener = (n: Notification) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const DEFAULT_DURATION: Record<NotificationType, number> = {
  info: 4000,
  success: 4000,
  warning: 6000,
  error: 0,
};

export function notify(
  message: string,
  type: NotificationType = "info",
  duration?: number,
): void {
  const n: Notification = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    message,
    duration: duration ?? DEFAULT_DURATION[type],
  };
  listeners.forEach((l) => l(n));
}
