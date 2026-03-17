import { useState, useEffect, useCallback } from "react";
import { subscribe, type Notification } from "../lib/notifications";

export function useNotifications() {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    return subscribe((n) => {
      setNotifications((prev) => [...prev, n]);
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return { notifications, dismiss };
}
