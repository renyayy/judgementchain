use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use crate::AppState;
use crate::config::Config;
use crate::database::ActivityLog;
use crate::vault::{FileEntry, NoteContent};

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
    pub edge_type: String,
    pub weight: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GraphData {
    pub nodes: Vec<GraphNodeData>,
    pub edges: Vec<GraphEdgeData>,
}

// ラベル付けレスポンス用
#[derive(Debug, Deserialize)]
struct LabelEntry {
    id: String,
    label: String,
}

/// vault内の .md ファイルをembeddingベースでクラスタリングしグラフデータを返す
#[tauri::command]
pub async fn analyze_vault_for_graph(
    dir_path: String,
    state: State<'_, AppState>,
) -> Result<GraphData, String> {
    use crate::graph_backend::{GraphBackend, ClaudeCliBackend, VertexAiBackend};

    let (graph_backend_name, sa_json, project_id, location, model, max_top_clusters) = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        (
            config.ai.graph_backend.clone(),
            config.ai.vertex_ai_service_account_json.clone(),
            config.ai.vertex_ai_project_id.clone(),
            config.ai.vertex_ai_location.clone(),
            config.ai.vertex_ai_model.clone(),
            config.ai.max_top_clusters,
        )
    };

    // 1. ファイル収集（隠しディレクトリ除外、上限なし）
    let expanded_dir = crate::config::expand_tilde(&dir_path);
    let mut md_files: Vec<String> = Vec::new();

    for entry in walkdir::WalkDir::new(&expanded_dir)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            e.file_name().to_str().map_or(true, |name| !name.starts_with('.'))
        })
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            if let Some(ext) = entry.path().extension() {
                if ext == "md" {
                    md_files.push(entry.path().to_string_lossy().to_string());
                }
            }
        }
    }

    if md_files.is_empty() {
        return Err("解析対象の.mdファイルが見つかりませんでした。".to_string());
    }

    eprintln!("[graph] {} 件のファイルを検出", md_files.len());

    // 2. 各ファイルのcontent_hash計算
    let mut file_hashes: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for path in &md_files {
        if let Ok(content) = std::fs::read_to_string(path) {
            use sha2::{Sha256, Digest};
            let hash = format!("{:x}", Sha256::digest(content.as_bytes()));
            file_hashes.insert(path.clone(), hash);
        }
    }

    // 3. キャッシュチェック
    let db = &state.db;
    if db.is_cluster_cache_valid(&dir_path, &file_hashes) {
        eprintln!("[graph] キャッシュヒット");
        if let Ok(Some(tree)) = db.get_cluster_tree(&dir_path) {
            return Ok(cluster_tree_to_graph_data(&tree));
        }
    }

    // 4. embeddingを取得（未計算のファイルはその場で生成）
    let (emb_backend, emb_model) = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        (config.ai.backend.clone(), config.ai.embedding_model.clone())
    };

    let mut file_embeddings: Vec<(String, Vec<f32>)> = Vec::new();
    let mut generated = 0;
    let mut failed = 0;
    for path in &md_files {
        match db.get_embedding(path) {
            Ok(Some(emb)) => file_embeddings.push((path.clone(), emb)),
            _ => {
                // embedding未計算 → その場で生成
                if let Ok(content) = std::fs::read_to_string(path) {
                    let content_hash = crate::vault::compute_content_hash(&content);
                    if let Some(emb) = crate::ai::generate_embedding(&emb_backend, &emb_model, &content) {
                        let _ = db.store_embedding(path, &emb, &content_hash);
                        file_embeddings.push((path.clone(), emb));
                        generated += 1;
                        eprintln!("[graph] embedding生成: {}", path);
                    } else {
                        failed += 1;
                        eprintln!("[graph] embedding生成失敗: {}", path);
                    }
                } else {
                    failed += 1;
                }
            }
        }
    }

    if generated > 0 {
        eprintln!("[graph] {} 件のembeddingを新規生成", generated);
    }

    if file_embeddings.is_empty() {
        return Err("embeddingを生成できませんでした。Ollamaが起動しているか確認してください。".to_string());
    }

    if failed > 0 {
        eprintln!("[graph] {} 件のファイルでembedding生成に失敗", failed);
    }

    eprintln!("[graph] {} 件のファイルでクラスタリング実行", file_embeddings.len());

    // 5. 再帰的クラスタリング
    let mut tree = crate::clustering::build_cluster_tree(&file_embeddings, max_top_clusters);

    // 6. LLMでラベル付け（GraphBackend経由）
    let backend: Option<Box<dyn GraphBackend>> = match graph_backend_name.as_str() {
        "vertex_ai" => {
            if !sa_json.is_empty() && !project_id.is_empty() {
                match crate::vertex_ai::get_access_token(&sa_json).await {
                    Ok(access_token) => Some(Box::new(VertexAiBackend { access_token, project_id, location, model })),
                    Err(e) => {
                        eprintln!("[graph] Vertex AI認証失敗、ラベルなしで続行: {}", e);
                        None
                    }
                }
            } else {
                eprintln!("[graph] Vertex AI未設定、ラベルなしで続行");
                None
            }
        }
        "claude" => Some(Box::new(ClaudeCliBackend)),
        _ => None,
    };

    if let Some(backend) = &backend {
        // レベル1以上（クラスタノード）にラベル付け
        for level_idx in 1..tree.levels.len() {
            let cluster_info: Vec<(String, Vec<String>)> = tree.levels[level_idx]
                .iter()
                .map(|node| {
                    let filenames: Vec<String> = node.file_paths.iter()
                        .map(|p| {
                            std::path::Path::new(p)
                                .file_name()
                                .and_then(|n| n.to_str())
                                .unwrap_or(p)
                                .to_string()
                        })
                        .collect();
                    (node.id.clone(), filenames)
                })
                .collect();

            let mut prompt = "以下のクラスタに、それぞれ短い日本語のジャンル名（5〜15文字）を付けてください。JSON配列のみを返してください（説明不要）:\n[{\"id\":\"クラスタID\",\"label\":\"ジャンル名\"}]\n\nクラスタ一覧:\n".to_string();

            for (id, files) in &cluster_info {
                prompt.push_str(&format!("- {}: {}\n", id, files.join(", ")));
            }

            match backend.query(&prompt).await {
                Ok(response) => {
                    let cleaned = crate::vertex_ai::clean_json_response_owned(&response);
                    if let Ok(labels) = serde_json::from_str::<Vec<LabelEntry>>(&cleaned) {
                        for label_entry in labels {
                            if let Some(node) = tree.levels[level_idx].iter_mut().find(|n| n.id == label_entry.id) {
                                node.label = Some(label_entry.label);
                            }
                        }
                    } else {
                        eprintln!("[graph] ラベルパース失敗、デフォルトラベルを使用");
                    }
                }
                Err(e) => {
                    eprintln!("[graph] ラベル付けエラー: {}", e);
                }
            }
        }
    }

    // ラベルがないノードにデフォルトラベルを設定
    for level in &mut tree.levels {
        for node in level.iter_mut() {
            if node.label.is_none() && !node.child_ids.is_empty() {
                node.label = Some(format!("グループ ({}件)", node.file_paths.len()));
            }
        }
    }

    // 7. キャッシュ保存
    if let Err(e) = db.store_cluster_tree(&dir_path, &tree, &file_hashes) {
        eprintln!("[graph] キャッシュ保存エラー: {}", e);
    }

    // 8. GraphDataに変換して返す
    Ok(cluster_tree_to_graph_data(&tree))
}

/// ClusterTree → GraphData 変換
fn cluster_tree_to_graph_data(tree: &crate::clustering::ClusterTree) -> GraphData {
    let mut nodes: Vec<GraphNodeData> = Vec::new();
    let mut edges: Vec<GraphEdgeData> = Vec::new();
    let mut edge_counter = 0usize;

    let total_levels = tree.levels.len();

    for (level_idx, level) in tree.levels.iter().enumerate() {
        for node in level {
            let (node_type, path, level_num) = if level_idx == 0 {
                // ファイルノード: level = 1
                ("file".to_string(), Some(node.id.clone()), 1u32)
            } else {
                // クラスタノード: level = level_idx + 1
                ("group".to_string(), None, (level_idx + 1) as u32)
            };

            let label = if level_idx == 0 {
                std::path::Path::new(&node.id)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(&node.id)
                    .to_string()
            } else {
                node.label.clone().unwrap_or_else(|| format!("L{}C{}", level_idx, &node.id))
            };

            nodes.push(GraphNodeData {
                id: node.id.clone(),
                node_type,
                label,
                path,
                keywords: vec![],
                level: level_num,
                group_id: node.parent_id.clone(),
                child_ids: node.child_ids.clone(),
            });

            // 子→親エッジ（階層エッジ）
            if let Some(parent_id) = &node.parent_id {
                edges.push(GraphEdgeData {
                    id: format!("e{}", edge_counter),
                    source: node.id.clone(),
                    target: parent_id.clone(),
                    edge_type: "hierarchy".to_string(),
                    weight: None,
                });
                edge_counter += 1;
            }
        }
    }

    // 同一レベルのノード間で類似エッジを生成（ファイルレベルは閾値を高くする）
    for (level_idx, level) in tree.levels.iter().enumerate() {
        if level.len() < 2 { continue; }
        // ファイルレベル(0)はペア数が多いため閾値を高く設定
        let similarity_threshold = if level_idx == 0 { 0.7f32 } else { 0.5f32 };
        // ファイルレベルで100件以上はエッジ生成をスキップ（O(n²)回避）
        if level_idx == 0 && level.len() > 100 { continue; }
        for i in 0..level.len() {
            for j in (i + 1)..level.len() {
                let sim = crate::clustering::cosine_similarity(&level[i].centroid, &level[j].centroid);
                if sim >= similarity_threshold {
                    edges.push(GraphEdgeData {
                        id: format!("e{}", edge_counter),
                        source: level[i].id.clone(),
                        target: level[j].id.clone(),
                        edge_type: "similarity".to_string(),
                        weight: Some(sim),
                    });
                    edge_counter += 1;
                }
            }
        }
    }

    // total_levels をノードに含める（フロントエンドでフロア選択に使用）
    if let Some(top_level) = tree.levels.last() {
        if let Some(top_node) = top_level.first() {
            if let Some(graph_node) = nodes.iter_mut().find(|n| n.id == top_node.id) {
                graph_node.keywords = vec![format!("total_levels:{}", total_levels)];
            }
        }
    }

    GraphData { nodes, edges }
}
