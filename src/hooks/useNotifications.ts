import { useState, useEffect, useCallback } from "react";
import { subscribe, type Notification } from "../lib/notifications";

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);

  useEffect(() => {
    return subscribe((n) => {
      setNotifications((prev) => [...prev, n]);
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    // 通知をアプリ終了まで「履歴として保持」しつつ、表示だけを消す
    setHiddenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    setHiddenIds([]);
  }, []);

  const visibleNotifications = notifications.filter((n) => !hiddenIds.includes(n.id));

  return { notifications, visibleNotifications, hiddenIds, dismiss, clearAll };
}
