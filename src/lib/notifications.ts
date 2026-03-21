export type NotificationType = "info" | "success" | "warning" | "error";

export interface Notification {
  id: string;
  type: NotificationType;
  message: string;
  /**
   * ms。0 = 手動で閉じるまで「表示」され続ける（履歴はアプリ終了まで保持）
   * duration は「表示時間」であり、履歴の消去タイミングではありません。
   */
  duration: number;
}

type Listener = (n: Notification) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const DEFAULT_DURATION: Record<NotificationType, number> = {
  // 約3秒で消す（"見えているトースト" の時間）
  info: 3000,
  success: 3000,
  warning: 3000,
  error: 3000,
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
