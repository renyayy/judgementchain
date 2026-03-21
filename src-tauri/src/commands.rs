use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use crate::AppState;
use crate::config::Config;
use crate::database::ActivityLog;
use crate::vault::{FileEntry, NoteContent};

#[derive(Serialize, Deserialize, Clone)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    pub main: String, // e.g. "main.js"
    pub capabilities: Option<Vec<String>>,
    pub enabled: Option<bool>,
}

#[derive(Serialize, Deserialize)]
pub struct MarginAnnotation {
    pub id: String,
    pub annotation_type: String,
    pub icon: String,
    pub title: String,
    pub content: String,
    pub link: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct SimilarNote {
    pub file_path: String,
    pub similarity: f32,
    pub preview: String,
}

#[derive(Serialize, Deserialize)]
pub struct CommitInfo {
    pub hash: String,
    pub message: String,
    pub timestamp: i64,
}

#[tauri::command]
pub async fn open_file(path: String, state: State<'_, AppState>) -> Result<NoteContent, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };

    let full_path = if path.starts_with('/') || path.starts_with('~') {
        path.clone()
    } else {
        format!("{}/{}", vault_path, path)
    };

    let note = crate::vault::read_note(&full_path)?;

    // Log activity
    let _ = state.db.log_activity(&full_path, "open", None);

    Ok(note)
}

#[tauri::command]
pub async fn save_file(path: String, content: String, state: State<'_, AppState>) -> Result<bool, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };

    let full_path = if path.starts_with('/') || path.starts_with('~') {
        path.clone()
    } else {
        format!("{}/{}", vault_path, path)
    };

    crate::vault::write_note(&full_path, &content)?;

    // Log activity
    let _ = state.db.log_activity(&full_path, "save", None);

    // Store wikilinks
    let wikilinks = crate::vault::extract_wikilinks(&content);
    let _ = state.db.store_wikilinks(&full_path, &wikilinks);

    // Auto-commit if enabled
    {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        if config.git.enabled && config.git.auto_commit {
            let file_name = std::path::Path::new(&full_path)
                .file_name().and_then(|n| n.to_str()).unwrap_or(&full_path);
            let msg = config.git.commit_message_template
                .replace("{action}", "save")
                .replace("{file}", file_name);
            let _ = crate::git::stage_file(&vault_path, &full_path);
            let _ = crate::git::commit_changes(&vault_path, &msg);
        }
    }

    // Async embedding (spawn thread, non-blocking)
    {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        if config.judgement_brain.enabled {
            let backend = config.ai.backend.clone();
            let model = config.ai.embedding_model.clone();
            let db = state.db.clone();
            let content_hash = crate::vault::compute_content_hash(&content);
            let path_clone = full_path.clone();
            let content_clone = content.clone();
            std::thread::spawn(move || {
                // Only regenerate if content changed
                if let Ok(Some(_)) = db.get_embedding(&path_clone) {
                    // Already have embedding; skip for now (could check hash)
                }
                if let Some(embedding) = crate::ai::generate_embedding(&backend, &model, &content_clone) {
                    let _ = db.store_embedding(&path_clone, &embedding, &content_hash);
                }
            });
        }
    }

    Ok(true)
}

#[tauri::command]
pub async fn embed_note(path: String, state: State<'_, AppState>) -> Result<bool, String> {
    let (vault_path, backend, model, enabled) = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        (
            config.get_vault_path().to_string_lossy().to_string(),
            config.ai.backend.clone(),
            config.ai.embedding_model.clone(),
            config.judgement_brain.enabled,
        )
    };

    if !enabled { return Ok(false); }

    let full_path = if path.starts_with('/') || path.starts_with('~') {
        path.clone()
    } else {
        format!("{}/{}", vault_path, path)
    };

    let content = std::fs::read_to_string(&full_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    let content_hash = crate::vault::compute_content_hash(&content);

    if let Some(embedding) = crate::ai::generate_embedding(&backend, &model, &content) {
        state.db.store_embedding(&full_path, &embedding, &content_hash)?;
        return Ok(true);
    }

    Ok(false)
}

#[tauri::command]
pub async fn get_similar_notes_for_margin(path: String, state: State<'_, AppState>) -> Result<Vec<MarginAnnotation>, String> {
    let (vault_path, threshold) = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        (
            config.get_vault_path().to_string_lossy().to_string(),
            config.judgement_brain.similarity_threshold,
        )
    };

    let full_path = if path.starts_with('/') || path.starts_with('~') {
        path.clone()
    } else {
        format!("{}/{}", vault_path, path)
    };

    let embedding = match state.db.get_embedding(&full_path)? {
        Some(e) => e,
        None => return Ok(vec![]),
    };

    let similar = state.db.find_similar(&embedding, 5, &full_path)?;

    let annotations = similar.into_iter()
        .filter(|(_, sim)| *sim >= threshold)
        .enumerate()
        .map(|(i, (file_path, similarity))| {
            let name = std::path::Path::new(&file_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string();
            MarginAnnotation {
                id: format!("similar_{}", i),
                annotation_type: "related_note".to_string(),
                icon: "💡".to_string(),
                title: name,
                content: format!("類似度: {:.0}%", similarity * 100.0),
                link: Some(file_path),
            }
        })
        .collect();

    Ok(annotations)
}

#[tauri::command]
pub async fn list_files(path: Option<String>, state: State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };

    let rel_path = path.as_deref();
    crate::vault::list_files(&vault_path, rel_path)
}

#[tauri::command]
pub async fn create_file(path: String, content: Option<String>, state: State<'_, AppState>) -> Result<bool, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };

    let full_path = if path.starts_with('/') || path.starts_with('~') {
        path.clone()
    } else {
        format!("{}/{}", vault_path, path)
    };

    crate::vault::create_note(&full_path, content.as_deref())?;

    // Log activity
    let _ = state.db.log_activity(&full_path, "create", None);

    Ok(true)
}

#[tauri::command]
pub async fn create_dir(path: String, state: State<'_, AppState>) -> Result<bool, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };

    let full_path = if path.starts_with('/') || path.starts_with('~') {
        path.clone()
    } else {
        format!("{}/{}", vault_path, path)
    };

    crate::vault::create_directory(&full_path)?;

    // Log activity
    let _ = state.db.log_activity(&full_path, "create_dir", None);

    Ok(true)
}

#[tauri::command]
pub async fn delete_file(path: String, state: State<'_, AppState>) -> Result<bool, String> {
    let (vault_path, trash_path) = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        let vault = config.get_vault_path().to_string_lossy().to_string();
        let trash = format!("{}/.trash", vault);
        (vault, trash)
    };

    let full_path = if path.starts_with('/') || path.starts_with('~') {
        path.clone()
    } else {
        format!("{}/{}", vault_path, path)
    };

    crate::vault::delete_note(&full_path, &trash_path)?;

    // Log activity
    let _ = state.db.log_activity(&full_path, "delete", None);

    Ok(true)
}

#[tauri::command]
pub async fn rename_file(old_path: String, new_path: String, state: State<'_, AppState>) -> Result<bool, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };

    let full_old = if old_path.starts_with('/') || old_path.starts_with('~') {
        old_path.clone()
    } else {
        format!("{}/{}", vault_path, old_path)
    };

    let full_new = if new_path.starts_with('/') || new_path.starts_with('~') {
        new_path.clone()
    } else {
        format!("{}/{}", vault_path, new_path)
    };

    crate::vault::rename_note(&full_old, &full_new)?;

    // Log activity
    let _ = state.db.log_activity(&full_old, "rename", None);

    Ok(true)
}

#[tauri::command]
pub async fn resolve_wikilink(link: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };

    let resolved = crate::vault::resolve_wikilink(&vault_path, &link);

    Ok(serde_json::json!({
        "path": resolved.as_deref().unwrap_or(""),
        "exists": resolved.is_some()
    }))
}

#[tauri::command]
pub async fn get_backlinks(path: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let backlinks = state.db.get_backlinks(&path)?;

    let links: Vec<serde_json::Value> = backlinks.into_iter()
        .map(|source| serde_json::json!({
            "source": source,
            "text": source.clone()
        }))
        .collect();

    Ok(serde_json::json!({ "links": links }))
}

#[tauri::command]
pub async fn get_config(state: State<'_, AppState>) -> Result<Config, String> {
    let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
    Ok(config.clone())
}

#[tauri::command]
pub async fn update_config(config: serde_json::Value, state: State<'_, AppState>) -> Result<bool, String> {
    let new_config: Config = serde_json::from_value(config)
        .map_err(|e| format!("Invalid config format: {}", e))?;

    new_config.save()?;

    let mut current = state.config.write().map_err(|e| format!("Config lock error: {}", e))?;
    *current = new_config;

    Ok(true)
}

#[tauri::command]
pub async fn reload_config(state: State<'_, AppState>) -> Result<bool, String> {
    let new_config = Config::load();

    let mut current = state.config.write().map_err(|e| format!("Config lock error: {}", e))?;
    *current = new_config;

    Ok(true)
}

#[tauri::command]
pub async fn list_plugins(state: State<'_, AppState>) -> Result<Vec<PluginManifest>, String> {
    let plugins_root = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_plugins_path()
    };
    if !plugins_root.exists() {
        return Ok(vec![]);
    }

    let mut out: Vec<PluginManifest> = vec![];

    for entry in std::fs::read_dir(&plugins_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        let raw = std::fs::read_to_string(&manifest_path)
            .map_err(|e| format!("Failed to read manifest: {}", e))?;
        let mut manifest: PluginManifest = serde_json::from_str(&raw)
            .map_err(|e| format!("Failed to parse manifest.json: {}", e))?;

        // manifest.id が空/欠落していた場合、フォルダ名を補完
        if manifest.id.trim().is_empty() {
            if let Some(folder_name) = path.file_name().and_then(|s| s.to_str()) {
                manifest.id = folder_name.to_string();
            }
        }

        out.push(manifest);
    }

    Ok(out)
}

#[tauri::command]
pub async fn read_plugin_file(
    pluginId: String,
    file: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let (vault_path, plugins_root) = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        (
            config.get_vault_path().to_string_lossy().to_string(),
            config.get_plugins_path(),
        )
    };

    if pluginId.contains('/') || pluginId.contains('\\') {
        return Err("Invalid pluginId".to_string());
    }
    if file.starts_with('/') || file.contains("..") || file.contains('\\') {
        return Err("Invalid file path".to_string());
    }

    // 1) plugins_path（デフォルト: ~/.config/nomos/plugins）を優先
    let plugin_dir_from_plugins_path = plugins_root.join(&pluginId);
    let full_path_plugins_root = plugin_dir_from_plugins_path.join(&file);
    let exists_plugins_root = full_path_plugins_root.exists();

    // 2) 互換: vault 配下の <vault>/.nomos/plugins もフォールバック
    let plugin_dir_from_vault = std::path::Path::new(&vault_path)
        .join(".nomos")
        .join("plugins")
        .join(&pluginId);
    let full_path_vault = plugin_dir_from_vault.join(&file);
    let exists_vault = full_path_vault.exists();

    let resolved_exists = exists_plugins_root || exists_vault;
    let resolved_full_path = if exists_plugins_root {
        full_path_plugins_root.clone()
    } else {
        full_path_vault.clone()
    };

    if !resolved_exists {
        return Err("Plugin file not found".to_string());
    }

    std::fs::read_to_string(&resolved_full_path)
        .map_err(|e| format!("Failed to read plugin file: {}", e))
}

#[tauri::command]
pub async fn get_activity_stats(state: State<'_, AppState>) -> Result<Vec<ActivityLog>, String> {
    state.db.get_activity_stats(50)
}

#[tauri::command]
pub async fn log_activity(
    file_path: String,
    action: String,
    duration_sec: Option<u32>,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    state.db.log_activity(&file_path, &action, duration_sec)?;
    Ok(true)
}

#[tauri::command]
pub async fn get_margin_annotations(path: String, state: State<'_, AppState>) -> Result<Vec<MarginAnnotation>, String> {
    // 1) 関連ノート（embedding 類似度）
    let embedding = state.db.get_embedding(&path)?.unwrap_or_default();
    let similar = state.db.find_similar(&embedding, 3, &path)?;

    let mut annotations: Vec<MarginAnnotation> = similar.into_iter()
        .enumerate()
        .map(|(i, (file_path, similarity))| {
            let name = std::path::Path::new(&file_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string();
            MarginAnnotation {
                id: format!("related_{}", i),
                annotation_type: "related_note".to_string(),
                icon: "💡".to_string(),
                title: name,
                content: format!("類似度 {:.0}%", similarity * 100.0),
                link: Some(file_path),
            }
        })
        .collect();

    // 2) キャッシュ済み矛盾（TTL 1時間）
    let contradictions = state.db.get_contradictions(&path)?;
    for (i, (conflicting_path, description)) in contradictions.into_iter().enumerate() {
        let name = std::path::Path::new(&conflicting_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Unknown")
            .to_string();
        annotations.push(MarginAnnotation {
            id: format!("contradiction_{}", i),
            annotation_type: "contradiction".to_string(),
            icon: "⚡".to_string(),
            title: name,
            content: description,
            link: Some(conflicting_path),
        });
    }

    // 3) 論文リンク（BibTeX + keyword 類似度）
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path()
    };
    let note_content = std::fs::read_to_string(&path).unwrap_or_default();
    let bib_files = crate::bibtex::find_bib_files(&vault_path);
    let mut papers: Vec<(f32, String, String, Option<String>)> = vec![]; // (score, title, summary, key)
    for bib_path in bib_files {
        for entry in crate::bibtex::parse_bib_file(&bib_path) {
            let text = entry.text_repr();
            let score = crate::bibtex::keyword_similarity(&note_content, &text);
            if score > 0.04 {
                let year_str = entry.year().map(|y| format!(", {}", y)).unwrap_or_default();
                let summary = format!("{}{}", entry.authors().chars().take(40).collect::<String>(), year_str);
                papers.push((score, entry.title().to_string(), summary, Some(entry.key.clone())));
            }
        }
    }
    papers.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    for (i, (_, title, summary, _)) in papers.into_iter().take(3).enumerate() {
        annotations.push(MarginAnnotation {
            id: format!("paper_{}", i),
            annotation_type: "paper".to_string(),
            icon: "📄".to_string(),
            title: title.chars().take(50).collect(),
            content: summary,
            link: None,
        });
    }

    // 4) 今週のサマリ（キャッシュがある場合のみ）
    let week_start = current_week_start();
    if let Ok(Some(summary)) = state.db.get_weekly_summary(week_start) {
        annotations.push(MarginAnnotation {
            id: "summary_0".to_string(),
            annotation_type: "summary".to_string(),
            icon: "📊".to_string(),
            title: "週次サマリ".to_string(),
            content: summary.chars().take(120).collect(),
            link: None,
        });
    }

    Ok(annotations)
}

fn current_week_start() -> i64 {
    use chrono::{Datelike, Duration, TimeZone, Utc};
    let now = Utc::now();
    let days_since_monday = now.weekday().num_days_from_monday() as i64;
    let monday = now - Duration::days(days_since_monday);
    Utc.with_ymd_and_hms(monday.year(), monday.month(), monday.day(), 0, 0, 0)
        .single()
        .map(|d| d.timestamp())
        .unwrap_or(0)
}

/// 今週のサマリをキャッシュから返す。なければ None。
#[tauri::command]
pub async fn get_weekly_summary(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.db.get_weekly_summary(current_week_start())
}

/// Candle を使って今週のサマリを生成・保存する。
#[tauri::command]
pub async fn generate_weekly_summary(state: State<'_, AppState>) -> Result<String, String> {
    let week_start = current_week_start();

    // 週次活動を取得
    let activity = state.db.get_week_activity(week_start)?;
    if activity.is_empty() {
        return Err("今週の活動記録がありません".to_string());
    }

    // 週ラベル（例: 2026-W12）
    let week_label = {
        use chrono::{Datelike, TimeZone, Utc};
        let dt = Utc.timestamp_opt(week_start, 0).single().unwrap_or_else(Utc::now);
        format!("{}-W{:02}", dt.year(), dt.iso_week().week())
    };

    let prompt = crate::ai::build_weekly_summary_prompt(&week_label, &activity);
    let candle_arc = std::sync::Arc::clone(&state.candle);

    let summary = tokio::task::spawn_blocking(move || {
        let mut guard = candle_arc.lock().map_err(|e| format!("Lock error: {}", e))?;
        let candle_state = guard.as_mut().ok_or("モデル未ロード")?;
        candle_state.generate(&prompt, 256, |_| {})
    })
    .await
    .map_err(|e| format!("タスクエラー: {}", e))??;

    state.db.store_weekly_summary(week_start, &summary)?;
    Ok(summary)
}

/// バックグラウンドで矛盾検出を実行し、結果をキャッシュに保存する。
/// モデルがロードされていない場合は即座に空を返す（graceful degradation）。
#[tauri::command]
pub async fn detect_contradictions(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<MarginAnnotation>, String> {
    // モデル未ロード時はスキップ
    {
        let guard = state.candle.lock().map_err(|e| format!("Lock error: {}", e))?;
        if guard.is_none() {
            return Ok(vec![]);
        }
    }

    // 現在のノート内容を読む
    let current_content = std::fs::read_to_string(&path)
        .map_err(|e| format!("ノート読み込み失敗: {}", e))?;

    // 既存キャッシュを無効化（再チェック）
    state.db.clear_contradictions(&path)?;

    // 類似ノートを取得（top 3）
    let embedding = state.db.get_embedding(&path)?.unwrap_or_default();
    let similar = state.db.find_similar(&embedding, 3, &path)?;
    if similar.is_empty() {
        return Ok(vec![]);
    }

    // 各類似ノートと矛盾チェック
    let mut results: Vec<MarginAnnotation> = vec![];

    for (similar_path, _) in similar {
        let other_content = match std::fs::read_to_string(&similar_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let prompt = crate::ai::build_contradiction_prompt(&current_content, &other_content);
        let candle_arc = std::sync::Arc::clone(&state.candle);

        // Candle 推論（spawn_blocking でノンブロッキング）
        let response = tokio::task::spawn_blocking(move || {
            let mut guard = candle_arc.lock().map_err(|e| format!("Lock error: {}", e))?;
            let candle_state = guard.as_mut().ok_or("モデル未ロード")?;
            candle_state.generate(&prompt, 128, |_| {})
        })
        .await
        .map_err(|e| format!("Task error: {}", e))??;

        if let Some(description) = crate::ai::parse_contradiction_response(&response) {
            // キャッシュに保存
            let _ = state.db.store_contradiction(&path, &similar_path, &description);

            let name = std::path::Path::new(&similar_path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("Unknown")
                .to_string();
            results.push(MarginAnnotation {
                id: format!("contradiction_{}", results.len()),
                annotation_type: "contradiction".to_string(),
                icon: "⚡".to_string(),
                title: name,
                content: description,
                link: Some(similar_path.clone()),
            });
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn get_related_notes(path: String, limit: Option<usize>, state: State<'_, AppState>) -> Result<Vec<SimilarNote>, String> {
    let top_k = limit.unwrap_or(5);

    // Try to get the embedding for this note
    let embedding = state.db.get_embedding(&path)?.unwrap_or_default();

    let similar = state.db.find_similar(&embedding, top_k, &path)?;

    let notes: Vec<SimilarNote> = similar.into_iter()
        .map(|(file_path, similarity)| {
            let preview = std::fs::read_to_string(&file_path)
                .ok()
                .map(|c| c.chars().take(200).collect::<String>())
                .unwrap_or_default();

            SimilarNote {
                file_path,
                similarity,
                preview,
            }
        })
        .collect();

    Ok(notes)
}

#[tauri::command]
pub async fn git_repo_status(state: State<'_, AppState>) -> Result<crate::git::GitStatus, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };
    Ok(crate::git::get_repo_status(&vault_path))
}

#[tauri::command]
pub async fn git_stage(file_path: String, state: State<'_, AppState>) -> Result<bool, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };
    crate::git::stage_file(&vault_path, &file_path)?;
    Ok(true)
}

#[tauri::command]
pub async fn git_unstage(file_path: String, state: State<'_, AppState>) -> Result<bool, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };
    crate::git::unstage_file(&vault_path, &file_path)?;
    Ok(true)
}

#[tauri::command]
pub async fn git_discard(file_path: String, state: State<'_, AppState>) -> Result<bool, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };
    crate::git::discard_file(&vault_path, &file_path)?;
    Ok(true)
}

#[tauri::command]
pub async fn git_commit(message: String, state: State<'_, AppState>) -> Result<bool, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };
    crate::git::commit_changes(&vault_path, &message)?;
    Ok(true)
}

#[tauri::command]
pub async fn git_log(limit: Option<usize>, state: State<'_, AppState>) -> Result<Vec<crate::git::GitCommit>, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };
    Ok(crate::git::get_log(&vault_path, limit.unwrap_or(50)))
}

#[tauri::command]
pub async fn git_show(hash: String, state: State<'_, AppState>) -> Result<String, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };
    let path = crate::config::expand_tilde(&vault_path);
    let git_root = crate::git::find_git_root_pub(&path).ok_or("Not a git repository")?;
    let out = std::process::Command::new("git")
        .args(["show", "--stat", "-p", &hash])
        .current_dir(&git_root)
        .output()
        .map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

#[tauri::command]
pub async fn git_init(state: State<'_, AppState>) -> Result<bool, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };
    crate::git::init_repo(&vault_path)?;
    Ok(true)
}

#[tauri::command]
pub async fn get_diff(path: String, _state: State<'_, AppState>) -> Result<String, String> {
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        // Try working-tree diff vs HEAD first (covers modified files)
        if let Ok(out) = std::process::Command::new("git")
            .args(["diff", "HEAD", "--", &path])
            .current_dir(parent)
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            if !text.trim().is_empty() {
                return Ok(text);
            }
        }
        // Fall back to cached diff (staged new files)
        if let Ok(out) = std::process::Command::new("git")
            .args(["diff", "--cached", "--", &path])
            .current_dir(parent)
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout).to_string();
            if !text.trim().is_empty() {
                return Ok(text);
            }
        }
        // Untracked file: synthesize a full-addition diff
        if p.exists() {
            if let Ok(content) = std::fs::read_to_string(p) {
                let mut out = format!("+++ {}\n", path);
                for line in content.lines() {
                    out.push('+');
                    out.push_str(line);
                    out.push('\n');
                }
                return Ok(out);
            }
        }
    }

    Ok(String::new())
}

#[tauri::command]
pub async fn get_history(path: String, limit: Option<usize>, state: State<'_, AppState>) -> Result<Vec<CommitInfo>, String> {
    let git_enabled = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.git.enabled
    };

    if !git_enabled {
        return Ok(vec![]);
    }

    let limit_str = limit.unwrap_or(20).to_string();
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        let output = std::process::Command::new("git")
            .args([
                "log",
                &format!("-{}", limit_str),
                "--pretty=format:%H%x1f%s%x1f%at",
                "--",
                &path,
            ])
            .current_dir(parent)
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                let log_str = String::from_utf8_lossy(&out.stdout);
                let commits: Vec<CommitInfo> = log_str
                    .lines()
                    .filter_map(|line| {
                        let parts: Vec<&str> = line.splitn(3, '\x1f').collect();
                        if parts.len() == 3 {
                            Some(CommitInfo {
                                hash: parts[0].to_string(),
                                message: parts[1].to_string(),
                                timestamp: parts[2].parse().unwrap_or(0),
                            })
                        } else {
                            None
                        }
                    })
                    .collect();
                return Ok(commits);
            }
        }
    }

    Ok(vec![])
}

/// バンドルされたモデルファイルのパスを返す
#[tauri::command]
pub async fn get_model_path(app: tauri::AppHandle) -> Result<String, String> {
    // config はフロント側から取得できるが、ここでは「バンドル or デフォルト」の解決結果を返す
    let path = crate::ai::resolve_model_path(&app, None)?;
    Ok(path.to_string_lossy().to_string())
}

/// Candle モデルをメモリにロードする（初回のみ / 重い処理）。
/// フロントエンドはアプリ起動後の適切なタイミングで一度だけ呼ぶ。
#[tauri::command]
pub async fn load_model(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // 既にロード済みならスキップ
    {
        let guard = state.candle.lock().map_err(|e| format!("ロックエラー: {}", e))?;
        if guard.is_some() {
            return Ok(());
        }
    }

    let configured_model_path = {
        let config = state
            .config
            .read()
            .map_err(|e| format!("Config lock error: {}", e))?;
        config.ai.model_path.clone()
    };

    let model_path = crate::ai::resolve_model_path(&app, Some(&configured_model_path))?;

    let mem_frac = {
        let config = state
            .config
            .read()
            .map_err(|e| format!("Config lock error: {}", e))?;
        config.performance.max_system_memory_fraction
    };
    crate::memory_budget::check_model_load_allowed(mem_frac, &model_path)?;

    let candle_arc = std::sync::Arc::clone(&state.candle);

    // モデルロードは重いので blocking スレッドで実行
    tokio::task::spawn_blocking(move || {
        let candle_state = crate::ai::CandleState::load(&model_path)?;
        let mut guard = candle_arc.lock().map_err(|e| format!("ロックエラー: {}", e))?;
        *guard = Some(candle_state);
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("タスクエラー: {}", e))??;

    Ok(())
}

/// Candle でテキストを生成する。
/// トークンは "llm-token" イベントでストリーミング送信される。
/// 戻り値は生成されたテキスト全体。
#[tauri::command]
pub async fn generate_text(
    prompt: String,
    max_tokens: Option<u32>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let candle_arc = std::sync::Arc::clone(&state.candle);
    let max_tokens = max_tokens.unwrap_or(512);

    let result = tokio::task::spawn_blocking(move || {
        let mut guard = candle_arc.lock().map_err(|e| format!("ロックエラー: {}", e))?;
        let candle = guard
            .as_mut()
            .ok_or_else(|| "モデル未ロード。先に load_model を呼んでください".to_string())?;

        candle.generate(&prompt, max_tokens, |piece| {
            let _ = app.emit("llm-token", piece.to_string());
        })
    })
    .await
    .map_err(|e| format!("タスクエラー: {}", e))??;

    Ok(result)
}

// ==================== グラフ分析コマンド ====================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphNodeData {
    pub id: String,
    #[serde(rename = "type")]
    pub node_type: String,  // "file" | "group"
    pub label: String,
    pub path: Option<String>,
    pub keywords: Vec<String>,
    pub level: u32,
    pub group_id: Option<String>,
    pub child_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphEdgeData {
    pub id: String,
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNodeData>,
    pub edges: Vec<GraphEdgeData>,
}

// Geminiレスポンス用中間型
#[derive(Debug, Deserialize)]
struct KeywordEntry {
    path: String,
    keywords: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct GroupEntry {
    #[serde(rename = "groupId")]
    group_id: String,
    #[serde(rename = "fileIds")]
    file_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct HierarchyChild {
    id: String,
    label: String,
    files: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct HierarchyTop {
    #[serde(rename = "id")]
    _id: String,
    label: String,
    children: Vec<HierarchyChild>,
}

#[derive(Debug, Deserialize)]
struct HierarchyResult {
    hierarchy: Vec<HierarchyTop>,
}

/// vault内の .md ファイルを解析してネットワークグラフデータを返す
#[tauri::command]
pub async fn analyze_vault_for_graph(
    dir_path: String,
    state: State<'_, AppState>,
) -> Result<GraphData, String> {
    // 設定から Vertex AI 情報を取得
    let (sa_json, project_id, location, model) = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        (
            config.ai.vertex_ai_service_account_json.clone(),
            config.ai.vertex_ai_project_id.clone(),
            config.ai.vertex_ai_location.clone(),
            config.ai.vertex_ai_model.clone(),
        )
    };

    eprintln!("[graph] project_id='{}', sa_json.len={}, sa_json.is_empty={}", project_id, sa_json.len(), sa_json.is_empty());
    if sa_json.is_empty() || project_id.is_empty() {
        return Err("Vertex AI設定が不完全です。Graphパネルの⚙設定からサービスアカウントJSONとプロジェクトIDを設定してください。".to_string());
    }

    // アクセストークン取得
    let access_token = crate::vertex_ai::get_access_token(&sa_json).await?;

    // .md ファイル一覧を収集（最大30件）
    let expanded_dir = crate::config::expand_tilde(&dir_path);
    let mut md_files: Vec<(String, String)> = Vec::new(); // (path, content_preview)

    for entry in walkdir::WalkDir::new(&expanded_dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            if let Some(ext) = entry.path().extension() {
                if ext == "md" {
                    let path_str = entry.path().to_string_lossy().to_string();
                    let preview = std::fs::read_to_string(entry.path())
                        .unwrap_or_default()
                        .chars()
                        .take(500)
                        .collect::<String>();
                    md_files.push((path_str, preview));
                    if md_files.len() >= 30 {
                        break;
                    }
                }
            }
        }
    }

    if md_files.is_empty() {
        return Err("解析対象の.mdファイルが見つかりませんでした。".to_string());
    }

    // Phase 1: キーワード抽出（5件バッチ）
    let mut keyword_map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();

    for chunk in md_files.chunks(5) {
        let mut prompt = "以下の複数のMarkdownファイルそれぞれから、内容を最もよく表す3〜5個のキーワードを日本語で抽出してください。JSON配列のみを返してください（説明不要）:\n[{\"path\":\"...\",\"keywords\":[\"kw1\",\"kw2\"]}]\n\n".to_string();

        for (path, content) in chunk {
            let filename = std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(path);
            prompt.push_str(&format!("--- ファイル: {} ---\n{}\n\n", filename, content));
            prompt.push_str(&format!("(フルパス: {})\n\n", path));
        }

        let response = crate::vertex_ai::call_gemini(&access_token, &project_id, &location, &model, &prompt).await?;
        let cleaned = crate::vertex_ai::clean_json_response(&response);

        let entries: Vec<KeywordEntry> = serde_json::from_str(cleaned)
            .map_err(|e| format!("キーワード抽出レスポンスパースエラー: {} / レスポンス: {}", e, cleaned))?;

        for entry in entries {
            keyword_map.insert(entry.path, entry.keywords);
        }
    }

    // Phase 2: グループ化（1コール）
    let mut kw_list_str = String::from("[");
    for (path, keywords) in &keyword_map {
        let filename = std::path::Path::new(path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(path);
        kw_list_str.push_str(&format!(
            "{{\"path\":\"{}\",\"filename\":\"{}\",\"keywords\":{}}},",
            path,
            filename,
            serde_json::to_string(keywords).unwrap_or_default()
        ));
    }
    if kw_list_str.ends_with(',') {
        kw_list_str.pop();
    }
    kw_list_str.push(']');

    let group_prompt = format!(
        "以下はMarkdownファイルとそのキーワードの一覧です。キーワードの類似性に基づいて、意味的に近いファイルをグループ化してください。グループ数は4〜8程度にしてください。JSON配列のみを返してください（説明不要）:\n[{{\"groupId\":\"g1\",\"fileIds\":[\"path1\",\"path2\"]}}]\n\nファイル一覧:\n{}",
        kw_list_str
    );

    let group_response = crate::vertex_ai::call_gemini(&access_token, &project_id, &location, &model, &group_prompt).await?;
    let group_cleaned = crate::vertex_ai::clean_json_response(&group_response);

    let groups: Vec<GroupEntry> = serde_json::from_str(group_cleaned)
        .map_err(|e| format!("グループ化レスポンスパースエラー: {} / レスポンス: {}", e, group_cleaned))?;

    // Phase 3: 2トップグループへの集約＋ラベリング（1コール）
    let mut groups_str = String::from("[");
    for g in &groups {
        let file_names: Vec<String> = g.file_ids.iter()
            .map(|p| std::path::Path::new(p)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(p)
                .to_string())
            .collect();
        groups_str.push_str(&format!(
            "{{\"id\":\"{}\",\"files\":{}}},",
            g.group_id,
            serde_json::to_string(&file_names).unwrap_or_default()
        ));
    }
    if groups_str.ends_with(',') {
        groups_str.pop();
    }
    groups_str.push(']');

    let hierarchy_prompt = format!(
        "以下のグループ一覧を、意味的に最も近いもの同士でまとめ、最終的に2つの大きなグループになるよう階層構造を作ってください。各グループ・サブグループに短い日本語のジャンル名（5〜15文字）を付けてください。JSONオブジェクトのみを返してください（説明不要）:\n{{\"hierarchy\":[{{\"id\":\"top1\",\"label\":\"ジャンル名\",\"children\":[{{\"id\":\"g1\",\"label\":\"サブジャンル名\",\"files\":[\"filename.md\"]}}]}}]}}\n\nグループ一覧:\n{}",
        groups_str
    );

    let hierarchy_response = crate::vertex_ai::call_gemini(&access_token, &project_id, &location, &model, &hierarchy_prompt).await?;
    let hierarchy_cleaned = crate::vertex_ai::clean_json_response(&hierarchy_response);

    let hierarchy: HierarchyResult = serde_json::from_str(hierarchy_cleaned)
        .map_err(|e| format!("階層化レスポンスパースエラー: {} / レスポンス: {}", e, hierarchy_cleaned))?;

    // グラフデータを構築
    let mut nodes: Vec<GraphNodeData> = Vec::new();
    let mut edges: Vec<GraphEdgeData> = Vec::new();
    let mut edge_counter = 0usize;

    // ファイルパスのlookup（filenameからfullpathへ）
    let path_lookup: std::collections::HashMap<String, String> = md_files.iter()
        .map(|(p, _)| {
            let name = std::path::Path::new(p)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(p)
                .to_string();
            (name, p.clone())
        })
        .collect();

    for (top_idx, top) in hierarchy.hierarchy.iter().enumerate() {
        let top_id = format!("top_{}", top_idx);

        // トップグループノード（level=3）
        nodes.push(GraphNodeData {
            id: top_id.clone(),
            node_type: "group".to_string(),
            label: top.label.clone(),
            path: None,
            keywords: vec![],
            level: 3,
            group_id: None,
            child_ids: top.children.iter().map(|c| format!("mid_{}_{}", top_idx, c.id)).collect(),
        });

        for (_child_idx, child) in top.children.iter().enumerate() {
            let mid_id = format!("mid_{}_{}", top_idx, child.id);

            // 中間グループノード（level=2）
            nodes.push(GraphNodeData {
                id: mid_id.clone(),
                node_type: "group".to_string(),
                label: child.label.clone(),
                path: None,
                keywords: vec![],
                level: 2,
                group_id: Some(top_id.clone()),
                child_ids: child.files.iter().map(|f| {
                    path_lookup.get(f).cloned().unwrap_or_else(|| f.clone())
                }).collect(),
            });

            // 中間グループ → トップグループ エッジ
            edges.push(GraphEdgeData {
                id: format!("e{}", edge_counter),
                source: mid_id.clone(),
                target: top_id.clone(),
            });
            edge_counter += 1;

            // ファイルノード（level=1）
            for filename in &child.files {
                let full_path = path_lookup.get(filename).cloned().unwrap_or_else(|| filename.clone());
                let label = std::path::Path::new(&full_path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&full_path)
                    .to_string();
                let file_keywords = keyword_map.get(&full_path).cloned().unwrap_or_default();

                nodes.push(GraphNodeData {
                    id: full_path.clone(),
                    node_type: "file".to_string(),
                    label,
                    path: Some(full_path.clone()),
                    keywords: file_keywords,
                    level: 1,
                    group_id: Some(mid_id.clone()),
                    child_ids: vec![],
                });

                // ファイル → 中間グループ エッジ
                edges.push(GraphEdgeData {
                    id: format!("e{}", edge_counter),
                    source: full_path.clone(),
                    target: mid_id.clone(),
                });
                edge_counter += 1;
            }
        }
    }

    Ok(GraphData { nodes, edges })
}
