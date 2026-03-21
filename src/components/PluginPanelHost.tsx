import { useEffect, useRef } from "react";
import type { PluginPanelRegistration } from "../plugins/types";

export function PluginPanelHost({ panel }: { panel: PluginPanelRegistration }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // プラグインは container に対して DOM を直接描画する
    const cleanup = panel.render(el);
    return () => {
      if (typeof cleanup === "function") cleanup();
    };
  }, [panel.id]);

  return (
    <aside className="plugin-panel-host">
      <div ref={containerRef} />
    </aside>
  );
}

