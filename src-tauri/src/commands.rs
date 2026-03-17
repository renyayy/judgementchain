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
    // Stub: return related notes based on stored embeddings
    // For now return an empty vec since we don't have real embedding computation yet
    let similar = state.db.find_similar(&[], 3, &path)?;

    let annotations: Vec<MarginAnnotation> = similar.into_iter()
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
                icon: "link".to_string(),
                title: name,
                content: format!("Similarity: {:.2}", similarity),
                link: Some(file_path),
            }
        })
        .collect();

    Ok(annotations)
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
pub async fn git_init(state: State<'_, AppState>) -> Result<bool, String> {
    let vault_path = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.get_vault_path().to_string_lossy().to_string()
    };
    crate::git::init_repo(&vault_path)?;
    Ok(true)
}

#[tauri::command]
pub async fn get_diff(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let git_enabled = {
        let config = state.config.read().map_err(|e| format!("Config lock error: {}", e))?;
        config.git.enabled
    };

    if !git_enabled {
        return Ok(String::new());
    }

    // Attempt to run git diff on the file
    let p = std::path::Path::new(&path);
    if let Some(parent) = p.parent() {
        let output = std::process::Command::new("git")
            .args(["diff", "HEAD", "--", &path])
            .current_dir(parent)
            .output();

        if let Ok(out) = output {
            if out.status.success() {
                return Ok(String::from_utf8_lossy(&out.stdout).to_string());
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
    let path = crate::ai::get_bundled_model_path(&app)?;
    Ok(path.to_string_lossy().to_string())
}

/// Gemma モデルをメモリにロードする（初回のみ / 重い処理）。
/// フロントエンドはアプリ起動後の適切なタイミングで一度だけ呼ぶ。
#[tauri::command]
pub async fn load_model(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // 既にロード済みならスキップ
    {
        let guard = state.llama.lock().map_err(|e| format!("ロックエラー: {}", e))?;
        if guard.is_some() {
            return Ok(());
        }
    }

    let model_path = crate::ai::get_bundled_model_path(&app)?;
    let llama_arc = std::sync::Arc::clone(&state.llama);

    // モデルロードは重いので blocking スレッドで実行
    tokio::task::spawn_blocking(move || {
        let llama_state = crate::ai::LlamaState::load(&model_path)?;
        let mut guard = llama_arc.lock().map_err(|e| format!("ロックエラー: {}", e))?;
        *guard = Some(llama_state);
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| format!("タスクエラー: {}", e))??;

    Ok(())
}

/// Gemma でテキストを生成する。
/// トークンは "llm-token" イベントでストリーミング送信される。
/// 戻り値は生成されたテキスト全体。
#[tauri::command]
pub async fn generate_text(
    prompt: String,
    max_tokens: Option<u32>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let llama_arc = std::sync::Arc::clone(&state.llama);
    let max_tokens = max_tokens.unwrap_or(512);

    let result = tokio::task::spawn_blocking(move || {
        let guard = llama_arc.lock().map_err(|e| format!("ロックエラー: {}", e))?;
        let llama = guard
            .as_ref()
            .ok_or_else(|| "モデル未ロード。先に load_model を呼んでください".to_string())?;

        llama.generate(&prompt, max_tokens, |piece| {
            let _ = app.emit("llm-token", piece.to_string());
        })
    })
    .await
    .map_err(|e| format!("タスクエラー: {}", e))??;

    Ok(result)
}
