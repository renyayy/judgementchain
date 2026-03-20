type RightPanel = "git" | "ai" | "graph" | "margin";

interface LeftActivityBarProps {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
}

interface RightActivityBarProps {
  rightPanel: RightPanel | null;
  onToggleRightPanel: (panel: RightPanel) => void;
}

export function LeftActivityBar({ sidebarOpen, onToggleSidebar, terminalOpen, onToggleTerminal }: LeftActivityBarProps) {
  return (
    <div className="activity-bar activity-bar--left">
      <div className="activity-bar-top">
        <button
          className={`activity-btn ${sidebarOpen ? "active" : ""}`}
          onClick={onToggleSidebar}
          title="ファイルツリー"
        >
          ☰
        </button>
      </div>
      <div className="activity-bar-bottom">
        <button
          className={`activity-btn ${terminalOpen ? "active" : ""}`}
          onClick={onToggleTerminal}
          title="ターミナル"
        >
          ⌨
        </button>
      </div>
    </div>
  );
}

export function RightActivityBar({ rightPanel, onToggleRightPanel }: RightActivityBarProps) {
  return (
    <div className="activity-bar activity-bar--right">
      <button
        className={`activity-btn ${rightPanel === "git" ? "active" : ""}`}
        onClick={() => onToggleRightPanel("git")}
        title="Git"
      >
        ⎇
      </button>
      <button
        className={`activity-btn ${rightPanel === "ai" ? "active" : ""}`}
        onClick={() => onToggleRightPanel("ai")}
        title="AI Chat"
      >
        ✦
      </button>
      <button
        className={`activity-btn ${rightPanel === "graph" ? "active" : ""}`}
        onClick={() => onToggleRightPanel("graph")}
        title="Graph"
      >
        ◈
      </button>
      <button
        className={`activity-btn ${rightPanel === "margin" ? "active" : ""}`}
        onClick={() => onToggleRightPanel("margin")}
        title="Judgement Brain"
      >
        ◧
      </button>
    </div>
  );
}
