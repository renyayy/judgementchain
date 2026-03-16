use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub vault: VaultConfig,
    pub ai: AiConfig,
    pub git: GitConfig,
    pub judgement_brain: JudgementBrainConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultConfig {
    pub path: String,
    pub auto_save_interval_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    pub backend: String,
    pub model_path: String,
    pub embedding_model: String,
    pub context_size: usize,
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
            },
            ai: AiConfig {
                backend: "ollama".to_string(),
                model_path: "".to_string(),
                embedding_model: "nomic-embed-text".to_string(),
                context_size: 4096,
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
        }
    }
}

impl Config {
    pub fn load() -> Self {
        let config_path = Self::config_file_path();
        if let Some(path) = config_path {
            if path.exists() {
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(config) = toml::from_str::<Config>(&content) {
                        return config;
                    }
                }
            }
        }
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

    fn config_file_path() -> Option<PathBuf> {
        dirs::config_dir().map(|d| d.join("nomos").join("config.toml"))
    }
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
