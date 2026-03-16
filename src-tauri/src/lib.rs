mod config;
mod database;
mod vault;
mod commands;
mod git;

use std::sync::{Arc, RwLock};
use config::Config;
use database::Database;

pub struct AppState {
    pub config: Arc<RwLock<Config>>,
    pub db: Arc<Database>,
}

impl AppState {
    pub fn new() -> Result<Self, String> {
        let config = Config::load();
        let db = Database::new()?;
        Ok(Self {
            config: Arc::new(RwLock::new(config)),
            db: Arc::new(db),
        })
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state = AppState::new().expect("Failed to initialize app state");

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::list_files,
            commands::create_file,
            commands::delete_file,
            commands::rename_file,
            commands::resolve_wikilink,
            commands::get_backlinks,
            commands::get_config,
            commands::update_config,
            commands::reload_config,
            commands::get_activity_stats,
            commands::log_activity,
            commands::get_margin_annotations,
            commands::get_related_notes,
            commands::get_diff,
            commands::get_history,
            commands::git_repo_status,
            commands::git_stage,
            commands::git_unstage,
            commands::git_commit,
            commands::git_log,
            commands::git_init,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
