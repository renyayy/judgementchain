import type { EditorTab } from "../types";

interface TabBarProps {
  tabs: EditorTab[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onSplit?: (id: string) => void;
}

const TAB_ICON: Record<string, string> = {
  diff: "⊟ ",
  commit: "⊙ ",
  file: "",
};

export function TabBar({ tabs, activeId, onSwitch, onClose, onSplit }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {tabs.map((tab) => {
        const name = tab.path.startsWith("commit:")
          ? tab.path.slice(7, 15)
          : (tab.path.split("/").pop() ?? tab.path);
        const isActive = tab.id === activeId;
        const icon = TAB_ICON[tab.tabType] ?? "";
        return (
          <div
            key={tab.id}
            className={`tab-item ${isActive ? "active" : ""}`}
            onClick={() => onSwitch(tab.id)}
            title={tab.path}
          >
            <span className="tab-name">{icon}{name}</span>
            {tab.isDirty && <span className="tab-dirty">●</span>}
            {onSplit && (
              <button
                className="tab-split"
                onClick={(e) => { e.stopPropagation(); onSplit(tab.id); }}
                title="右に開く"
              >
                ◫
              </button>
            )}
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
