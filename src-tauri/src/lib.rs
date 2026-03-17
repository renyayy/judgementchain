mod config;
mod database;
mod vault;
mod commands;
mod git;
mod watcher;
mod ai;
mod bibtex;

use std::sync::{Arc, Mutex, RwLock};
use config::Config;
use database::Database;

pub struct AppState {
    pub config: Arc<RwLock<Config>>,
    pub db: Arc<Database>,
    /// Candle モデル（初回 load_model コマンドでセットされる）
    pub candle: Arc<Mutex<Option<crate::ai::CandleState>>>,
}

impl AppState {
    pub fn new() -> Result<Self, String> {
        let config = Config::load();
        let db = Database::new()?;
        Ok(Self {
            config: Arc::new(RwLock::new(config)),
            db: Arc::new(db),
            candle: Arc::new(Mutex::new(None)),
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
        .setup(|app| {
            // ファイル変更監視を起動（configを直接ロードして vault path を取得）
            let app_handle = app.handle().clone();
            let config = crate::config::Config::load();
            let vault_path = config.get_vault_path().to_string_lossy().to_string();
            crate::watcher::start(app_handle, vault_path);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::save_file,
            commands::list_files,
            commands::create_file,
            commands::create_dir,
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
            commands::git_show,
            commands::git_init,
            commands::embed_note,
            commands::get_similar_notes_for_margin,
            commands::get_model_path,
            commands::load_model,
            commands::generate_text,
            commands::detect_contradictions,
            commands::get_weekly_summary,
            commands::generate_weekly_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
