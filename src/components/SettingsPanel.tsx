import type { AppSettings } from "../hooks/useSettings";

interface SettingsPanelProps {
  settings: AppSettings;
  onUpdateSettings: (partial: Partial<AppSettings>) => void;
}

export function SettingsPanel({ settings, onUpdateSettings }: SettingsPanelProps) {
  const handleFontSizeChange = (value: string) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n >= 8 && n <= 32) {
      onUpdateSettings({ fontSize: n });
    }
  };

  return (
    <div className="settings-panel">
      <h2 className="settings-title">Settings</h2>

      <section className="settings-section">
        <h3 className="settings-section-title">Editor</h3>

        <div className="settings-row">
          <label className="settings-label" htmlFor="settings-font-size">
            Font Size
          </label>
          <p className="settings-description">
            エディタのフォントサイズをピクセル単位で指定します。
          </p>
          <div className="settings-control">
            <input
              id="settings-font-size"
              type="number"
              className="settings-input-number"
              min={8}
              max={32}
              value={settings.fontSize}
              onChange={(e) => handleFontSizeChange(e.target.value)}
            />
            <button
              className="settings-reset-btn"
              onClick={() => onUpdateSettings({ fontSize: 14 })}
              title="デフォルト (14px) にリセット"
            >
              Reset
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h3 className="settings-section-title">Appearance</h3>

        <div className="settings-row">
          <label className="settings-label">Theme</label>
          <p className="settings-description">
            アプリケーション全体のカラーテーマを切り替えます。
          </p>
          <div className="settings-theme-toggle">
            <button
              className={`settings-theme-btn ${settings.theme === "dark" ? "active" : ""}`}
              onClick={() => onUpdateSettings({ theme: "dark" })}
            >
              Dark
            </button>
            <button
              className={`settings-theme-btn ${settings.theme === "light" ? "active" : ""}`}
              onClick={() => onUpdateSettings({ theme: "light" })}
            >
              Light
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
