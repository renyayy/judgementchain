import { TabBar } from "./TabBar";
import { Editor } from "./Editor";
import { FileViewer, isViewableFile } from "./FileViewer";
import { DiffView, CommitDetail } from "./GitDiff";
import type { EditorTab } from "../types";

export interface PaneState {
  tabs: EditorTab[];
  activeId: string | null;
}

interface EditorPaneProps {
  pane: PaneState;
  isActive: boolean;
  onFocus: () => void;
  onSwitch: (id: string) => void;
  onClose: (id: string) => void;
  onSplit: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseToRight: (id: string) => void;
  onCloseAll: () => void;
  onEditorChange: (value: string) => void;
  onNavigate: (path: string) => void;
}

export function EditorPane({
  pane, isActive, onFocus, onSwitch, onClose, onSplit, onCloseOthers, onCloseToRight, onCloseAll, onEditorChange, onNavigate,
}: EditorPaneProps) {
  const activeTab = pane.tabs.find((t) => t.id === pane.activeId) ?? null;

  return (
    <div
      className={`editor-pane ${isActive ? "editor-pane--active" : ""}`}
      onMouseDown={onFocus}
    >
      <TabBar
        tabs={pane.tabs}
        activeId={pane.activeId}
        onSwitch={onSwitch}
        onClose={onClose}
        onSplit={onSplit}
        onCloseOthers={onCloseOthers}
        onCloseToRight={onCloseToRight}
        onCloseAll={onCloseAll}
      />
      <div className="editor-pane-content">
        {!activeTab ? (
          <div className="editor-empty">ファイルを開いてください</div>
        ) : activeTab.tabType === "diff" ? (
          <DiffView path={activeTab.path} content={activeTab.rawDiff ?? ""} />
        ) : activeTab.tabType === "commit" ? (
          <CommitDetail raw={activeTab.rawDiff ?? ""} />
        ) : isViewableFile(activeTab.path) ? (
          <FileViewer filePath={activeTab.path} />
        ) : (
          <Editor
            content={activeTab.content}
            filePath={activeTab.path}
            isDirty={activeTab.isDirty}
            onChange={onEditorChange}
            onNavigate={onNavigate}
          />
        )}
      </div>
    </div>
  );
}
