use rusqlite::{Connection, Result as SqlResult, params};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActivityLog {
    pub id: i64,
    pub file_path: String,
    pub action: String,
    pub timestamp: i64,
    pub duration_sec: Option<u32>,
}

impl Database {
    pub fn new() -> Result<Self, String> {
        let db_path = Self::db_file_path()?;

        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create data directory: {}", e))?;
        }

        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        Self::init_schema(&conn).map_err(|e| format!("Failed to initialize schema: {}", e))?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn db_file_path() -> Result<std::path::PathBuf, String> {
        crate::config::xdg_data_dir()
            .map(|d| d.join("nomos").join("nomos.db"))
            .ok_or_else(|| "Could not determine data directory".to_string())
    }

    fn init_schema(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS activity_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                action TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                duration_sec INTEGER
            );

            CREATE TABLE IF NOT EXISTS note_embeddings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL UNIQUE,
                embedding BLOB NOT NULL,
                content_hash TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS weekly_summaries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                week_start INTEGER NOT NULL,
                week_end INTEGER NOT NULL,
                summary TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS wikilinks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                target TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS contradiction_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_a TEXT NOT NULL,
                file_b TEXT NOT NULL,
                description TEXT NOT NULL,
                checked_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cluster_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vault_path TEXT NOT NULL,
                level INTEGER NOT NULL,
                cluster_id TEXT NOT NULL,
                centroid BLOB NOT NULL,
                file_paths TEXT NOT NULL,
                child_ids TEXT NOT NULL,
                parent_id TEXT,
                label TEXT,
                UNIQUE(vault_path, cluster_id)
            );

            CREATE TABLE IF NOT EXISTS cluster_meta (
                vault_path TEXT PRIMARY KEY,
                total_levels INTEGER NOT NULL,
                file_hashes TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_wikilinks_source ON wikilinks(source);
            CREATE INDEX IF NOT EXISTS idx_wikilinks_target ON wikilinks(target);
            CREATE INDEX IF NOT EXISTS idx_activity_log_file ON activity_log(file_path);
            CREATE INDEX IF NOT EXISTS idx_note_embeddings_path ON note_embeddings(file_path);
            CREATE INDEX IF NOT EXISTS idx_cluster_cache_vault ON cluster_cache(vault_path);
        ")?;
        Ok(())
    }

    pub fn log_activity(&self, file_path: &str, action: &str, duration_sec: Option<u32>) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        let timestamp = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT INTO activity_log (file_path, action, timestamp, duration_sec) VALUES (?1, ?2, ?3, ?4)",
            params![file_path, action, timestamp, duration_sec],
        ).map_err(|e| format!("Failed to log activity: {}", e))?;
        Ok(())
    }

    pub fn get_activity_stats(&self, limit: usize) -> Result<Vec<ActivityLog>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT id, file_path, action, timestamp, duration_sec FROM activity_log ORDER BY timestamp DESC LIMIT ?1"
        ).map_err(|e| format!("Failed to prepare statement: {}", e))?;

        let logs = stmt.query_map(params![limit as i64], |row| {
            Ok(ActivityLog {
                id: row.get(0)?,
                file_path: row.get(1)?,
                action: row.get(2)?,
                timestamp: row.get(3)?,
                duration_sec: row.get(4)?,
            })
        }).map_err(|e| format!("Failed to query activity log: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

        Ok(logs)
    }

    pub fn store_wikilinks(&self, source: &str, targets: &[String]) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        let timestamp = chrono::Utc::now().timestamp();

        conn.execute("DELETE FROM wikilinks WHERE source = ?1", params![source])
            .map_err(|e| format!("Failed to delete old wikilinks: {}", e))?;

        for target in targets {
            conn.execute(
                "INSERT INTO wikilinks (source, target, updated_at) VALUES (?1, ?2, ?3)",
                params![source, target, timestamp],
            ).map_err(|e| format!("Failed to insert wikilink: {}", e))?;
        }

        Ok(())
    }

    pub fn get_backlinks(&self, target: &str) -> Result<Vec<String>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT source FROM wikilinks WHERE target = ?1"
        ).map_err(|e| format!("Failed to prepare statement: {}", e))?;

        let links = stmt.query_map(params![target], |row| {
            row.get::<_, String>(0)
        }).map_err(|e| format!("Failed to query backlinks: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

        Ok(links)
    }

    pub fn store_embedding(&self, file_path: &str, embedding: &[f32], content_hash: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        let timestamp = chrono::Utc::now().timestamp();

        // Convert f32 slice to bytes
        let bytes: Vec<u8> = embedding.iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();

        conn.execute(
            "INSERT OR REPLACE INTO note_embeddings (file_path, embedding, content_hash, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![file_path, bytes, content_hash, timestamp],
        ).map_err(|e| format!("Failed to store embedding: {}", e))?;

        Ok(())
    }

    pub fn get_embedding(&self, file_path: &str) -> Result<Option<Vec<f32>>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        let result = conn.query_row(
            "SELECT embedding FROM note_embeddings WHERE file_path = ?1",
            params![file_path],
            |row| row.get::<_, Vec<u8>>(0),
        );

        match result {
            Ok(bytes) => {
                let floats = bytes_to_f32_vec(&bytes);
                Ok(Some(floats))
            }
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Failed to get embedding: {}", e)),
        }
    }

    pub fn find_similar(&self, embedding: &[f32], top_k: usize, exclude_path: &str) -> Result<Vec<(String, f32)>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        let mut stmt = conn.prepare(
            "SELECT file_path, embedding FROM note_embeddings WHERE file_path != ?1"
        ).map_err(|e| format!("Failed to prepare statement: {}", e))?;

        let mut similarities: Vec<(String, f32)> = stmt.query_map(params![exclude_path], |row| {
            let path: String = row.get(0)?;
            let bytes: Vec<u8> = row.get(1)?;
            Ok((path, bytes))
        }).map_err(|e| format!("Failed to query embeddings: {}", e))?
        .filter_map(|r| r.ok())
        .map(|(path, bytes)| {
            let stored_embedding = bytes_to_f32_vec(&bytes);
            let sim = cosine_similarity(embedding, &stored_embedding);
            (path, sim)
        })
        .collect();

        similarities.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        similarities.truncate(top_k);

        Ok(similarities)
    }

    /// 矛盾検出結果をキャッシュに保存（同ペアの既存エントリは上書き）
    pub fn store_contradiction(&self, file_a: &str, file_b: &str, description: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT OR REPLACE INTO contradiction_cache (file_a, file_b, description, checked_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![file_a, file_b, description, now],
        ).map_err(|e| format!("Failed to store contradiction: {}", e))?;
        Ok(())
    }

    /// ノートに関連する矛盾を取得（TTL 1時間）
    /// 返り値: Vec<(相手ノートパス, 説明)>
    pub fn get_contradictions(&self, file_path: &str) -> Result<Vec<(String, String)>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        let ttl_cutoff = chrono::Utc::now().timestamp() - 3600;

        let mut stmt = conn.prepare(
            "SELECT file_b, description FROM contradiction_cache
             WHERE file_a = ?1 AND checked_at > ?2"
        ).map_err(|e| format!("Failed to prepare statement: {}", e))?;

        let rows = stmt.query_map(params![file_path, ttl_cutoff], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| format!("Failed to query contradictions: {}", e))?
        .filter_map(|r| r.ok())
        .collect();

        Ok(rows)
    }

    /// ノートの矛盾キャッシュを無効化（ノート編集時に呼ぶ）
    pub fn clear_contradictions(&self, file_path: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        conn.execute(
            "DELETE FROM contradiction_cache WHERE file_a = ?1 OR file_b = ?1",
            params![file_path],
        ).map_err(|e| format!("Failed to clear contradictions: {}", e))?;
        Ok(())
    }

    // ─── 週次サマリ ──────────────────────────────────────────────────────────

    /// 週次サマリを保存・更新（week_start = その週の月曜 00:00 UTC Unix タイムスタンプ）
    pub fn store_weekly_summary(&self, week_start: i64, summary: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        let now = chrono::Utc::now().timestamp();
        let week_end = week_start + 604_800; // +7日
        conn.execute(
            "INSERT OR REPLACE INTO weekly_summaries (week_start, week_end, summary, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![week_start, week_end, summary, now],
        ).map_err(|e| format!("Failed to store weekly summary: {}", e))?;
        Ok(())
    }

    /// 指定した週のサマリを取得
    pub fn get_weekly_summary(&self, week_start: i64) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        let result = conn.query_row(
            "SELECT summary FROM weekly_summaries WHERE week_start = ?1",
            params![week_start],
            |row| row.get::<_, String>(0),
        );
        match result {
            Ok(s) => Ok(Some(s)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Failed to get weekly summary: {}", e)),
        }
    }

    /// 今週の活動ログを集計（ファイルごとのアクセス回数）
    pub fn get_week_activity(&self, week_start: i64) -> Result<Vec<(String, u32)>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        let week_end = week_start + 604_800;
        let mut stmt = conn.prepare(
            "SELECT file_path, COUNT(*) as cnt FROM activity_log
             WHERE timestamp >= ?1 AND timestamp < ?2
             GROUP BY file_path ORDER BY cnt DESC LIMIT 10",
        ).map_err(|e| format!("Failed to prepare statement: {}", e))?;
        let rows = stmt.query_map(params![week_start, week_end], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?))
        }).map_err(|e| format!("Failed to query week activity: {}", e))?
        .filter_map(|r| r.ok())
        .collect();
        Ok(rows)
    }

    // --- クラスタリングキャッシュ ---

    pub fn store_cluster_tree(
        &self,
        vault_path: &str,
        tree: &crate::clustering::ClusterTree,
        file_hashes: &std::collections::HashMap<String, String>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;

        // 既存キャッシュを削除
        conn.execute("DELETE FROM cluster_cache WHERE vault_path = ?1", params![vault_path])
            .map_err(|e| format!("Failed to clear cluster cache: {}", e))?;
        conn.execute("DELETE FROM cluster_meta WHERE vault_path = ?1", params![vault_path])
            .map_err(|e| format!("Failed to clear cluster meta: {}", e))?;

        // 各レベルのノードを保存
        for (level_idx, level) in tree.levels.iter().enumerate() {
            for node in level {
                let centroid_bytes: Vec<u8> = node.centroid.iter().flat_map(|f| f.to_le_bytes()).collect();
                let file_paths_json = serde_json::to_string(&node.file_paths).unwrap_or_default();
                let child_ids_json = serde_json::to_string(&node.child_ids).unwrap_or_default();

                conn.execute(
                    "INSERT OR REPLACE INTO cluster_cache (vault_path, level, cluster_id, centroid, file_paths, child_ids, parent_id, label) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        vault_path,
                        level_idx as i64,
                        node.id,
                        centroid_bytes,
                        file_paths_json,
                        child_ids_json,
                        node.parent_id,
                        node.label,
                    ],
                ).map_err(|e| format!("Failed to store cluster node: {}", e))?;
            }
        }

        // メタ情報を保存
        let hashes_json = serde_json::to_string(file_hashes).unwrap_or_default();
        let now = chrono::Utc::now().timestamp();
        conn.execute(
            "INSERT OR REPLACE INTO cluster_meta (vault_path, total_levels, file_hashes, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![vault_path, tree.levels.len() as i64, hashes_json, now],
        ).map_err(|e| format!("Failed to store cluster meta: {}", e))?;

        Ok(())
    }

    pub fn get_cluster_tree(&self, vault_path: &str) -> Result<Option<crate::clustering::ClusterTree>, String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;

        // メタ情報を取得
        let total_levels: i64 = match conn.query_row(
            "SELECT total_levels FROM cluster_meta WHERE vault_path = ?1",
            params![vault_path],
            |row| row.get(0),
        ) {
            Ok(v) => v,
            Err(_) => return Ok(None),
        };

        let mut levels: Vec<Vec<crate::clustering::ClusterNode>> = Vec::new();

        for level_idx in 0..total_levels {
            let mut stmt = conn.prepare(
                "SELECT cluster_id, centroid, file_paths, child_ids, parent_id, label FROM cluster_cache WHERE vault_path = ?1 AND level = ?2"
            ).map_err(|e| format!("Prepare error: {}", e))?;

            let nodes: Vec<crate::clustering::ClusterNode> = stmt.query_map(
                params![vault_path, level_idx],
                |row| {
                    let centroid_bytes: Vec<u8> = row.get(1)?;
                    let file_paths_json: String = row.get(2)?;
                    let child_ids_json: String = row.get(3)?;
                    let parent_id: Option<String> = row.get(4)?;
                    let label: Option<String> = row.get(5)?;

                    Ok(crate::clustering::ClusterNode {
                        id: row.get(0)?,
                        centroid: bytes_to_f32_vec(&centroid_bytes),
                        file_paths: serde_json::from_str(&file_paths_json).unwrap_or_default(),
                        child_ids: serde_json::from_str(&child_ids_json).unwrap_or_default(),
                        parent_id,
                        label,
                    })
                },
            ).map_err(|e| format!("Query error: {}", e))?
            .filter_map(|r| r.ok())
            .collect();

            levels.push(nodes);
        }

        Ok(Some(crate::clustering::ClusterTree { levels }))
    }

    pub fn is_cluster_cache_valid(
        &self,
        vault_path: &str,
        current_hashes: &std::collections::HashMap<String, String>,
    ) -> bool {
        let conn = match self.conn.lock() {
            Ok(c) => c,
            Err(_) => return false,
        };

        let stored_hashes_json: String = match conn.query_row(
            "SELECT file_hashes FROM cluster_meta WHERE vault_path = ?1",
            params![vault_path],
            |row| row.get(0),
        ) {
            Ok(v) => v,
            Err(_) => return false,
        };

        let stored_hashes: std::collections::HashMap<String, String> =
            serde_json::from_str(&stored_hashes_json).unwrap_or_default();

        &stored_hashes == current_hashes
    }

    pub fn clear_cluster_cache(&self, vault_path: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| format!("Lock error: {}", e))?;
        conn.execute("DELETE FROM cluster_cache WHERE vault_path = ?1", params![vault_path])
            .map_err(|e| format!("Failed to clear cluster cache: {}", e))?;
        conn.execute("DELETE FROM cluster_meta WHERE vault_path = ?1", params![vault_path])
            .map_err(|e| format!("Failed to clear cluster meta: {}", e))?;
        Ok(())
    }
}

fn bytes_to_f32_vec(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4)
        .map(|chunk| {
            let arr: [u8; 4] = chunk.try_into().unwrap_or([0; 4]);
            f32::from_le_bytes(arr)
        })
        .collect()
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || b.is_empty() || a.len() != b.len() {
        return 0.0;
    }

    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let mag_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let mag_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

    if mag_a == 0.0 || mag_b == 0.0 {
        return 0.0;
    }

    dot / (mag_a * mag_b)
}
