import type { EditorTab } from "../types";

interface TabBarProps {
  tabs: EditorTab[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
}

export function TabBar({ tabs, activeId, onSwitch, onClose }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {tabs.map((tab) => {
        const name = tab.path.split("/").pop() ?? tab.path;
        const isActive = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={`tab-item ${isActive ? "active" : ""}`}
            onClick={() => onSwitch(tab.id)}
            title={tab.path}
          >
            <span className="tab-name">{name}</span>
            {tab.isDirty && <span className="tab-dirty">●</span>}
            <button
              className="tab-close"
              onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
              title="閉じる"
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
