import { useState, useEffect } from "react";
import type { EditorTab } from "../types";

interface ContextMenuState {
  tabId: string;
  x: number;
  y: number;
}

interface TabBarProps {
  tabs: EditorTab[];
  activeId: string | null;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onSplit?: (id: string) => void;
  onCloseOthers?: (id: string) => void;
  onCloseToRight?: (id: string) => void;
  onCloseAll?: () => void;
}

const TAB_ICON: Record<string, string> = {
  diff: "⊟ ",
  commit: "⊙ ",
  settings: "⚙ ",
  file: "",
};

export function TabBar({ tabs, activeId, onSwitch, onClose, onSplit, onCloseOthers, onCloseToRight, onCloseAll }: TabBarProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [contextMenu]);

  if (tabs.length === 0) return null;

  const contextTabIndex = contextMenu ? tabs.findIndex((t) => t.id === contextMenu.tabId) : -1;
  const hasTabsToRight = contextMenu ? contextTabIndex >= 0 && contextTabIndex < tabs.length - 1 : false;
  const hasOtherTabs = tabs.length > 1;

  return (
    <div className="tab-bar">
      {tabs.map((tab) => {
        const name = tab.tabType === "settings"
          ? "Settings"
          : tab.path.startsWith("commit:")
          ? tab.path.slice(7, 15)
          : (tab.path.split("/").pop() ?? tab.path);
        const isActive = tab.id === activeId;
        const icon = TAB_ICON[tab.tabType] ?? "";
        return (
          <div
            key={tab.id}
            className={`tab-item ${isActive ? "active" : ""}`}
            onClick={() => onSwitch(tab.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
            }}
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

      {contextMenu && (
        <div
          className="tab-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <button
            className="tab-context-menu-item"
            onClick={() => { onClose(contextMenu.tabId); setContextMenu(null); }}
          >
            閉じる
          </button>
          {onCloseOthers && hasOtherTabs && (
            <button
              className="tab-context-menu-item"
              onClick={() => { onCloseOthers(contextMenu.tabId); setContextMenu(null); }}
            >
              他のタブを閉じる
            </button>
          )}
          {onCloseToRight && hasTabsToRight && (
            <button
              className="tab-context-menu-item"
              onClick={() => { onCloseToRight(contextMenu.tabId); setContextMenu(null); }}
            >
              右のタブをすべて閉じる
            </button>
          )}
          {onCloseAll && (
            <>
              <div className="tab-context-menu-separator" />
              <button
                className="tab-context-menu-item"
                onClick={() => { onCloseAll(); setContextMenu(null); }}
              >
                すべて閉じる
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
