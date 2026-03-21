use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: String,
    pub files: Vec<GitFileStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitFileStatus {
    pub path: String,
    pub status: String,
    pub staged: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub message: String,
    pub timestamp: i64,
    pub refs: String,
}

pub fn find_git_root_pub(path: &Path) -> Option<std::path::PathBuf> {
    find_git_root(path)
}

fn find_git_root(path: &Path) -> Option<std::path::PathBuf> {
    let mut current = if path.is_file() {
        path.parent()?.to_path_buf()
    } else {
        path.to_path_buf()
    };
    loop {
        if current.join(".git").exists() {
            return Some(current);
        }
        match current.parent() {
            Some(parent) => current = parent.to_path_buf(),
            None => return None,
        }
    }
}

pub fn get_repo_status(vault_path: &str) -> GitStatus {
    let path = crate::config::expand_tilde(vault_path);
    let git_root = match find_git_root(&path) {
        Some(r) => r,
        None => return GitStatus { is_repo: false, branch: String::new(), files: vec![] },
    };

    let branch = std::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&git_root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "HEAD".to_string());

    let status_output = std::process::Command::new("git")
        .args(["status", "--porcelain", "-u"])
        .current_dir(&git_root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let root_str = git_root.to_string_lossy().to_string();

    let files: Vec<GitFileStatus> = status_output
        .lines()
        .filter(|l| l.len() >= 3)
        .map(|line| {
            let x = &line[0..1];
            let y = &line[1..2];
            let rel_path = line[3..].to_string();
            let full_path = format!("{}/{}", root_str, rel_path);

            if x != " " && x != "?" {
                GitFileStatus { path: full_path, status: x.to_string(), staged: true }
            } else {
                GitFileStatus { path: full_path, status: y.to_string(), staged: false }
            }
        })
        .collect();

    GitStatus { is_repo: true, branch, files }
}

fn to_relative(git_root: &std::path::Path, file_path: &str) -> String {
    let p = std::path::Path::new(file_path);
    p.strip_prefix(git_root)
        .map(|r| r.to_string_lossy().to_string())
        .unwrap_or_else(|_| file_path.to_string())
}

pub fn stage_file(vault_path: &str, file_path: &str) -> Result<(), String> {
    let path = crate::config::expand_tilde(vault_path);
    let git_root = find_git_root(&path).ok_or("Not a git repository")?;
    let rel = to_relative(&git_root, file_path);

    let output = std::process::Command::new("git")
        .args(["add", &rel])
        .current_dir(&git_root)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub fn unstage_file(vault_path: &str, file_path: &str) -> Result<(), String> {
    let path = crate::config::expand_tilde(vault_path);
    let git_root = find_git_root(&path).ok_or("Not a git repository")?;
    let rel = to_relative(&git_root, file_path);

    let output = std::process::Command::new("git")
        .args(["restore", "--staged", &rel])
        .current_dir(&git_root)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub fn commit_changes(vault_path: &str, message: &str) -> Result<(), String> {
    let path = crate::config::expand_tilde(vault_path);
    let git_root = find_git_root(&path).ok_or("Not a git repository")?;

    let output = std::process::Command::new("git")
        .args(["commit", "-m", message])
        .current_dir(&git_root)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

pub fn get_log(vault_path: &str, limit: usize) -> Vec<GitCommit> {
    let path = crate::config::expand_tilde(vault_path);
    let git_root = match find_git_root(&path) {
        Some(r) => r,
        None => return vec![],
    };

    let output = std::process::Command::new("git")
        .args([
            "log",
            &format!("-{}", limit),
            "--all",
            "--format=%H\x1f%P\x1f%s\x1f%at\x1f%D",
        ])
        .current_dir(&git_root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    output
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(5, '\x1f').collect();
            if parts.len() == 5 {
                let hash = parts[0].to_string();
                let short_hash = hash[..7.min(hash.len())].to_string();
                Some(GitCommit {
                    short_hash,
                    hash,
                    parents: parts[1].split_whitespace().map(|s| s.to_string()).collect(),
                    message: parts[2].to_string(),
                    timestamp: parts[3].parse().unwrap_or(0),
                    refs: parts[4].to_string(),
                })
            } else {
                None
            }
        })
        .collect()
}

pub fn discard_file(vault_path: &str, file_path: &str) -> Result<(), String> {
    let path = crate::config::expand_tilde(vault_path);
    let git_root = find_git_root(&path).ok_or("Not a git repository")?;
    let rel = to_relative(&git_root, file_path);

    let output = std::process::Command::new("git")
        .args(["restore", &rel])
        .current_dir(&git_root)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}

/// 特定ファイルの過去コミット一覧を取得する（タイムスタンプ付き）。
/// auto-commit のノイズを避けるため、1時間以上前のコミットのみ返す。
pub fn get_file_history(vault_path: &str, file_path: &str, limit: usize) -> Vec<(String, i64)> {
    let path = crate::config::expand_tilde(vault_path);
    let git_root = match find_git_root(&path) {
        Some(r) => r,
        None => return vec![],
    };
    let rel = to_relative(&git_root, file_path);

    let output = std::process::Command::new("git")
        .args([
            "log",
            &format!("-{}", limit + 10), // 余分に取得（フィルタ用）
            "--format=%H\x1f%at",
            "--follow",
            "--",
            &rel,
        ])
        .current_dir(&git_root)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();

    let one_hour_ago = chrono::Utc::now().timestamp() - 3600;

    output
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(2, '\x1f').collect();
            if parts.len() == 2 {
                let hash = parts[0].to_string();
                let ts: i64 = parts[1].parse().unwrap_or(0);
                // 直近1時間のコミットはスキップ（auto-commit ノイズ回避）
                if ts < one_hour_ago {
                    Some((hash, ts))
                } else {
                    None
                }
            } else {
                None
            }
        })
        .take(limit)
        .collect()
}

/// 特定コミット時点のファイル内容を取得する。
pub fn get_file_at_commit(vault_path: &str, file_path: &str, commit_hash: &str) -> Result<String, String> {
    let path = crate::config::expand_tilde(vault_path);
    let git_root = find_git_root(&path).ok_or("Not a git repository")?;
    let rel = to_relative(&git_root, file_path);

    let output = std::process::Command::new("git")
        .args(["show", &format!("{}:{}", commit_hash, rel)])
        .current_dir(&git_root)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn init_repo(vault_path: &str) -> Result<(), String> {
    let path = crate::config::expand_tilde(vault_path);
    let output = std::process::Command::new("git")
        .args(["init"])
        .current_dir(&path)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(())
}
