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
        dirs::data_local_dir()
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

            CREATE INDEX IF NOT EXISTS idx_wikilinks_source ON wikilinks(source);
            CREATE INDEX IF NOT EXISTS idx_wikilinks_target ON wikilinks(target);
            CREATE INDEX IF NOT EXISTS idx_activity_log_file ON activity_log(file_path);
            CREATE INDEX IF NOT EXISTS idx_note_embeddings_path ON note_embeddings(file_path);
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
