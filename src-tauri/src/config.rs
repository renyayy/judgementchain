use serde::{Deserialize, Serialize};
use std::path::PathBuf;

fn default_vertex_location() -> String {
    "us-central1".to_string()
}

fn default_vertex_model() -> String {
    "gemini-2.0-flash-001".to_string()
}

fn default_max_system_memory_fraction() -> f64 {
    0.8
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceConfig {
    /// プロセスの仮想メモリ上限を、搭載物理メモリのこの割合に抑える（1.0 = 100%）。0 以下で無効。
    #[serde(default = "default_max_system_memory_fraction")]
    pub max_system_memory_fraction: f64,
}

impl Default for PerformanceConfig {
    fn default() -> Self {
        Self {
            max_system_memory_fraction: default_max_system_memory_fraction(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub vault: VaultConfig,
    pub ai: AiConfig,
    pub git: GitConfig,
    pub judgement_brain: JudgementBrainConfig,
    #[serde(default)]
    pub performance: PerformanceConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultConfig {
    pub path: String,
    pub auto_save_interval_ms: u64,
    #[serde(default)]
    pub plugins_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub backend: String,
    pub model_path: String,
    pub embedding_model: String,
    pub context_size: usize,
    #[serde(default)]
    pub vertex_ai_service_account_json: String,
    #[serde(default)]
    pub vertex_ai_project_id: String,
    #[serde(default = "default_vertex_location")]
    pub vertex_ai_location: String,
    #[serde(default = "default_vertex_model")]
    pub vertex_ai_model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitConfig {
    pub enabled: bool,
    pub auto_commit: bool,
    pub commit_message_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JudgementBrainConfig {
    pub enabled: bool,
    pub similarity_threshold: f32,
    pub contradiction_check_idle_ms: u64,
    pub update_debounce_ms: u64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            vault: VaultConfig {
                path: "~/Documents/nomos-vault".to_string(),
                auto_save_interval_ms: 2000,
                plugins_path: None,
            },
            ai: AiConfig {
                backend: "ollama".to_string(),
                model_path: "".to_string(),
                embedding_model: "nomic-embed-text".to_string(),
                context_size: 4096,
                vertex_ai_service_account_json: "".to_string(),
                vertex_ai_project_id: "".to_string(),
                vertex_ai_location: default_vertex_location(),
                vertex_ai_model: default_vertex_model(),
            },
            git: GitConfig {
                enabled: false,
                auto_commit: false,
                commit_message_template: "auto: {action} {file}".to_string(),
            },
            judgement_brain: JudgementBrainConfig {
                enabled: true,
                similarity_threshold: 0.7,
                contradiction_check_idle_ms: 3000,
                update_debounce_ms: 500,
            },
            performance: PerformanceConfig::default(),
        }
    }
}

impl Config {
    pub fn load() -> Self {
        let config_path = Self::config_file_path();
        if let Some(path) = &config_path {
            eprintln!("[config] loading from: {}", path.display());
            if path.exists() {
                match std::fs::read_to_string(path) {
                    Ok(content) => {
                        match toml::from_str::<Config>(&content) {
                            Ok(config) => {
                                eprintln!("[config] loaded OK, ai.backend={}, project_id={}", config.ai.backend, config.ai.vertex_ai_project_id);
                                return config;
                            }
                            Err(e) => {
                                eprintln!("[config] TOML parse error: {}", e);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[config] file read error: {}", e);
                    }
                }
            } else {
                eprintln!("[config] file not found: {}", path.display());
            }
        }
        eprintln!("[config] using default config");
        Config::default()
    }

    pub fn save(&self) -> Result<(), String> {
        let config_path = Self::config_file_path()
            .ok_or_else(|| "Could not determine config directory".to_string())?;

        if let Some(parent) = config_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create config directory: {}", e))?;
        }

        let content = toml::to_string_pretty(self)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        std::fs::write(&config_path, content)
            .map_err(|e| format!("Failed to write config file: {}", e))?;

        Ok(())
    }

    pub fn get_vault_path(&self) -> PathBuf {
        expand_tilde(&self.vault.path)
    }

    pub fn get_plugins_path(&self) -> PathBuf {
        match &self.vault.plugins_path {
            Some(p) if !p.is_empty() => expand_tilde(p),
            _ => dirs::home_dir()
                .map(|h| h.join(".config").join("nomos").join("plugins"))
                .unwrap_or_else(|| self.get_vault_path().join(".nomos").join("plugins")),
        }
    }

    fn config_file_path() -> Option<PathBuf> {
        xdg_config_dir().map(|d| d.join("nomos").join("config.toml"))
    }
}

/// XDG Base Directory Specification に準拠したコンフィグディレクトリを返す。
/// `$XDG_CONFIG_HOME` が絶対パスで設定されていればそれを使い、
/// なければプラットフォームデフォルト（Linux: ~/.config, macOS: ~/Library/Application Support）にフォールバックする。
pub fn xdg_config_dir() -> Option<PathBuf> {
    if let Ok(val) = std::env::var("XDG_CONFIG_HOME") {
        let p = PathBuf::from(val);
        if p.is_absolute() {
            return Some(p);
        }
    }
    dirs::config_dir()
}

/// XDG Base Directory Specification に準拠したデータディレクトリを返す。
/// `$XDG_DATA_HOME` が絶対パスで設定されていればそれを使い、
/// なければプラットフォームデフォルトにフォールバックする。
pub fn xdg_data_dir() -> Option<PathBuf> {
    if let Ok(val) = std::env::var("XDG_DATA_HOME") {
        let p = PathBuf::from(val);
        if p.is_absolute() {
            return Some(p);
        }
    }
    dirs::data_local_dir()
}

pub fn expand_tilde(path: &str) -> PathBuf {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(&path[2..]);
        }
    } else if path == "~" {
        if let Some(home) = dirs::home_dir() {
            return home;
        }
    }
    PathBuf::from(path)
}
