use serde::{Deserialize, Serialize};
use walkdir::WalkDir;
use regex::Regex;
use sha2::{Sha256, Digest};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
    pub modified_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteContent {
    pub content: String,
    pub frontmatter: Option<serde_json::Value>,
    pub wikilinks: Vec<String>,
    pub tags: Vec<String>,
}

pub fn list_files(vault_path: &str, relative_path: Option<&str>) -> Result<Vec<FileEntry>, String> {
    let base = crate::config::expand_tilde(vault_path);
    let search_path = if let Some(rel) = relative_path {
        base.join(rel)
    } else {
        base
    };

    if !search_path.exists() {
        std::fs::create_dir_all(&search_path)
            .map_err(|e| format!("Failed to create vault directory: {}", e))?;
        return Ok(vec![]);
    }

    build_tree(&search_path)
}

fn build_tree(dir: &std::path::Path) -> Result<Vec<FileEntry>, String> {
    let mut entries: Vec<FileEntry> = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory: {}", e))?
        .filter_map(|e| e.ok())
        .filter_map(|entry| {
            let path = entry.path();
            let is_dir = path.is_dir();
            let name = path.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            // 隠しフォルダ・ファイルをスキップ
            if name.starts_with('.') {
                return None;
            }

            // 対応する拡張子以外はスキップ
            const ALLOWED_EXTS: &[&str] = &["md", "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf"];
            if !is_dir {
                let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");
                if !ALLOWED_EXTS.contains(&ext) {
                    return None;
                }
            }

            let modified_at = entry.metadata().ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);

            let path_str = path.to_string_lossy().to_string();

            let children = if is_dir {
                build_tree(&path).ok()
            } else {
                None
            };

            Some(FileEntry {
                path: path_str,
                name,
                is_dir,
                children,
                modified_at,
            })
        })
        .collect();

    entries.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

pub fn read_note(path: &str) -> Result<NoteContent, String> {
    let p = crate::config::expand_tilde(path);
    let file_path = if p.is_dir() {
        p.join("index.md")
    } else {
        p
    };

    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path.display()));
    }

    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let (frontmatter, body) = if let Some((fm, body)) = parse_frontmatter(&content) {
        (Some(fm), body)
    } else {
        (None, content.clone())
    };

    let wikilinks = extract_wikilinks(&body);
    let tags = extract_tags(&body);

    Ok(NoteContent {
        content,
        frontmatter,
        wikilinks,
        tags,
    })
}

pub fn write_note(path: &str, content: &str) -> Result<(), String> {
    let p = crate::config::expand_tilde(path);
    let file_path = if p.is_dir() {
        p.join("index.md")
    } else {
        p
    };

    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

pub fn create_note(path: &str, content: Option<&str>) -> Result<(), String> {
    let p = crate::config::expand_tilde(path);

    if p.exists() {
        return Err(format!("File already exists: {}", p.display()));
    }

    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let default_content = content.unwrap_or("").to_string();
    std::fs::write(&p, default_content)
        .map_err(|e| format!("Failed to create file: {}", e))?;

    Ok(())
}

pub fn create_directory(path: &str) -> Result<(), String> {
    let p = crate::config::expand_tilde(path);

    if p.exists() {
        return Err(format!("Directory already exists: {}", p.display()));
    }

    std::fs::create_dir_all(&p)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    Ok(())
}

pub fn delete_note(path: &str, trash_path: &str) -> Result<(), String> {
    let src = crate::config::expand_tilde(path);
    let trash = crate::config::expand_tilde(trash_path);

    if !src.exists() {
        return Err(format!("File not found: {}", src.display()));
    }

    std::fs::create_dir_all(&trash)
        .map_err(|e| format!("Failed to create trash directory: {}", e))?;

    let file_name = src.file_name()
        .ok_or_else(|| "Invalid file name".to_string())?;

    let timestamp = chrono::Utc::now().timestamp();
    let trash_file_name = format!("{}_{}", timestamp, file_name.to_string_lossy());
    let dest = trash.join(trash_file_name);

    std::fs::rename(&src, &dest)
        .map_err(|e| format!("Failed to move file to trash: {}", e))?;

    Ok(())
}

pub fn rename_note(old_path: &str, new_path: &str) -> Result<(), String> {
    let old = crate::config::expand_tilde(old_path);
    let new = crate::config::expand_tilde(new_path);

    if !old.exists() {
        return Err(format!("File not found: {}", old.display()));
    }

    if new.exists() {
        return Err(format!("Destination already exists: {}", new.display()));
    }

    if let Some(parent) = new.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    std::fs::rename(&old, &new)
        .map_err(|e| format!("Failed to rename file: {}", e))?;

    Ok(())
}

pub fn resolve_wikilink(vault_path: &str, link_text: &str) -> Option<String> {
    let base = crate::config::expand_tilde(vault_path);

    // Try exact match with .md extension
    let direct = base.join(format!("{}.md", link_text));
    if direct.exists() {
        return Some(direct.to_string_lossy().to_string());
    }

    // Try as directory with index.md
    let dir_index = base.join(link_text).join("index.md");
    if dir_index.exists() {
        return Some(base.join(link_text).to_string_lossy().to_string());
    }

    // Search recursively for a file with matching name
    for entry in WalkDir::new(&base).into_iter().filter_map(|e| e.ok()) {
        let entry_path = entry.path();
        if entry_path.extension().and_then(|e| e.to_str()) == Some("md") {
            let stem = entry_path.file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("");
            if stem.eq_ignore_ascii_case(link_text) {
                return Some(entry_path.to_string_lossy().to_string());
            }
        }
    }

    None
}

pub fn extract_wikilinks(content: &str) -> Vec<String> {
    let re = Regex::new(r"\[\[([^\|\]]+)(?:\|[^\]]+)?\]\]").unwrap();
    re.captures_iter(content)
        .map(|cap| cap[1].trim().to_string())
        .collect()
}

pub fn extract_tags(content: &str) -> Vec<String> {
    let re = Regex::new(r"(?:^|\s)#([a-zA-Z0-9_\-/]+)").unwrap();
    let mut tags: Vec<String> = re.captures_iter(content)
        .map(|cap| cap[1].to_string())
        .collect();

    // Also extract from frontmatter tags field
    if let Some((fm, _)) = parse_frontmatter(content) {
        if let Some(fm_tags) = fm.get("tags") {
            if let Some(arr) = fm_tags.as_array() {
                for tag in arr {
                    if let Some(s) = tag.as_str() {
                        let tag_str = s.to_string();
                        if !tags.contains(&tag_str) {
                            tags.push(tag_str);
                        }
                    }
                }
            }
        }
    }

    tags.dedup();
    tags
}

pub fn parse_frontmatter(content: &str) -> Option<(serde_json::Value, String)> {
    if !content.starts_with("---\n") {
        return None;
    }

    let after_first = &content[4..];
    let end_pos = after_first.find("\n---\n").or_else(|| after_first.find("\n---"))?;

    let fm_str = &after_first[..end_pos];
    let body_start = end_pos + 5; // skip "\n---\n"
    let body = if body_start <= after_first.len() {
        after_first[body_start..].to_string()
    } else {
        String::new()
    };

    // Parse simple key:value YAML pairs
    let mut map = serde_json::Map::new();
    for line in fm_str.lines() {
        if let Some(colon_pos) = line.find(':') {
            let key = line[..colon_pos].trim().to_string();
            let value_str = line[colon_pos + 1..].trim();

            if key.is_empty() {
                continue;
            }

            // Try to parse as array [item1, item2]
            if value_str.starts_with('[') && value_str.ends_with(']') {
                let inner = &value_str[1..value_str.len() - 1];
                let items: Vec<serde_json::Value> = inner.split(',')
                    .map(|s| serde_json::Value::String(s.trim().trim_matches('"').trim_matches('\'').to_string()))
                    .collect();
                map.insert(key, serde_json::Value::Array(items));
            } else if value_str == "true" {
                map.insert(key, serde_json::Value::Bool(true));
            } else if value_str == "false" {
                map.insert(key, serde_json::Value::Bool(false));
            } else if let Ok(n) = value_str.parse::<i64>() {
                map.insert(key, serde_json::Value::Number(n.into()));
            } else if let Ok(f) = value_str.parse::<f64>() {
                map.insert(key, serde_json::json!(f));
            } else {
                let clean_value = value_str.trim_matches('"').trim_matches('\'').to_string();
                map.insert(key, serde_json::Value::String(clean_value));
            }
        }
    }

    Some((serde_json::Value::Object(map), body))
}

pub fn compute_content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}
