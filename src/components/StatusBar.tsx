import { useEffect, useMemo, useRef } from "react";
import type { PluginStatusBarItemRegistration } from "../plugins/types";
import { usePluginRegistry } from "../plugins/registry";

function StatusBarItemHost({ item }: { item: PluginStatusBarItemRegistration }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const cleanup = item.render(el);
    return () => {
      if (typeof cleanup === "function") cleanup();
    };
  }, [item.id]);

  return <div className="status-bar-item" ref={containerRef} />;
}

export function StatusBar() {
  const { statusBarItems, loading } = usePluginRegistry();

  const ordered = useMemo(() => statusBarItems, [statusBarItems]);

  return (
    <div className="status-bar">
      <div className="status-bar-left">
        <span className="status-bar-label">Nomos</span>
        {loading && <span className="status-bar-hint">プラグインロード中...</span>}
      </div>
      <div className="status-bar-items">
        {ordered.map((item) => (
          <StatusBarItemHost key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

