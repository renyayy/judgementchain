import { useMemo } from "react";
import { usePluginRegistry } from "../plugins/registry";

function statusLabel(status: string, error?: string) {
  if (status === "loaded") return "loaded";
  if (status === "error") return error ? `error: ${error}` : "error";
  return "skipped";
}

export function PluginSettings() {
  const { loading, pluginStates, setPluginEnabled, reload } = usePluginRegistry();

  const sorted = useMemo(() => {
    return [...pluginStates].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return a.manifest.name.localeCompare(b.manifest.name);
    });
  }, [pluginStates]);

  return (
    <aside className="plugin-settings-panel">
      <div className="plugin-settings-header">
        <span className="plugin-settings-title">Plugins</span>
        <button
          className="plugin-settings-reload-btn"
          disabled={loading}
          onClick={() => void reload()}
          title="プラグインを再読み込み"
        >
          ↻
        </button>
      </div>

      <div className="plugin-settings-body">
        {sorted.length === 0 && <div className="plugin-settings-empty">プラグインが見つかりません</div>}

        {sorted.map((ps) => {
          const id = ps.manifest.id;
          return (
            <div key={id} className="plugin-row">
              <div className="plugin-row-main">
                <div className="plugin-row-name">{ps.manifest.name}</div>
                <div className="plugin-row-meta">
                  <span className="plugin-row-id">{id}</span>
                  <span className="plugin-row-dot">·</span>
                  <span className="plugin-row-version">{ps.manifest.version}</span>
                </div>
                <div className="plugin-row-status">{statusLabel(ps.status, ps.error)}</div>
              </div>

              <div className="plugin-row-actions">
                <label className="plugin-toggle">
                  <input
                    type="checkbox"
                    checked={ps.enabled}
                    disabled={loading}
                    onChange={(e) => {
                      setPluginEnabled(id, e.target.checked);
                      void reload();
                    }}
                  />
                  <span className="plugin-toggle-label">{ps.enabled ? "ON" : "OFF"}</span>
                </label>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

