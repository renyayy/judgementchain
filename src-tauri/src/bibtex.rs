/// 簡易 BibTeX パーサー + ノートとの類似度計算

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

// ─── 型定義 ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct BibEntry {
    pub key: String,
    #[allow(dead_code)]
    pub entry_type: String,
    pub fields: HashMap<String, String>,
}

impl BibEntry {
    pub fn title(&self) -> &str {
        self.fields.get("title").map(|s| s.as_str()).unwrap_or("")
    }
    pub fn authors(&self) -> &str {
        self.fields.get("author").map(|s| s.as_str()).unwrap_or("")
    }
    pub fn year(&self) -> Option<u32> {
        self.fields.get("year").and_then(|y| y.trim().parse().ok())
    }
    /// タイトル + 著者 + abstract を結合したテキスト表現
    pub fn text_repr(&self) -> String {
        let abs = self.fields.get("abstract").map(|s| s.as_str()).unwrap_or("");
        format!("{} {} {}", self.title(), self.authors(), abs)
    }
}

// ─── ファイルスキャン ─────────────────────────────────────────────────────────

/// vault 内の .bib ファイルをすべて列挙する
pub fn find_bib_files(vault_path: &Path) -> Vec<PathBuf> {
    WalkDir::new(vault_path)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().map(|x| x == "bib").unwrap_or(false))
        .map(|e| e.path().to_path_buf())
        .collect()
}

/// .bib ファイルを読み込んでエントリ一覧を返す
pub fn parse_bib_file(path: &Path) -> Vec<BibEntry> {
    let content = std::fs::read_to_string(path).unwrap_or_default();
    parse_bibtex(&content)
}

// ─── パーサー ─────────────────────────────────────────────────────────────────

pub fn parse_bibtex(content: &str) -> Vec<BibEntry> {
    let mut entries = Vec::new();
    let bytes = content.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        // @ を探す
        if bytes[i] != b'@' {
            i += 1;
            continue;
        }
        let type_start = i + 1;

        // エントリタイプを読む
        let type_end = content[type_start..]
            .find(|c: char| !c.is_alphanumeric())
            .map(|x| type_start + x)
            .unwrap_or(type_start);
        let entry_type = content[type_start..type_end].to_lowercase();

        // comment / string / preamble はスキップ
        if matches!(entry_type.as_str(), "comment" | "string" | "preamble") {
            i = type_end;
            continue;
        }

        // 開き波括弧を探す
        let Some(brace_off) = content[type_end..].find('{') else {
            break;
        };
        let body_start = type_end + brace_off + 1;

        // 対応する閉じ波括弧を探す
        let mut depth = 1usize;
        let mut body_end = body_start;
        for (j, c) in content[body_start..].char_indices() {
            match c {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        body_end = body_start + j;
                        break;
                    }
                }
                _ => {}
            }
        }

        let body = &content[body_start..body_end];

        // エントリキー（最初のカンマまで）
        let Some(comma) = body.find(',') else {
            i = body_end + 1;
            continue;
        };
        let key = body[..comma].trim().to_string();
        let fields = parse_fields(&body[comma + 1..]);

        entries.push(BibEntry { key, entry_type, fields });
        i = body_end + 1;
    }

    entries
}

fn parse_fields(text: &str) -> HashMap<String, String> {
    let mut fields = HashMap::new();
    let bytes = text.as_bytes();
    let mut pos = 0;

    loop {
        // 空白・カンマをスキップ
        while pos < bytes.len()
            && (bytes[pos] == b',' || bytes[pos].is_ascii_whitespace())
        {
            pos += 1;
        }
        if pos >= bytes.len() {
            break;
        }

        // フィールド名 (= まで)
        let name_start = pos;
        while pos < bytes.len() && bytes[pos] != b'=' {
            pos += 1;
        }
        let name = text[name_start..pos].trim().to_lowercase();
        if name.is_empty() || pos >= bytes.len() {
            break;
        }
        pos += 1; // skip '='

        // 先行空白をスキップ
        while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
            pos += 1;
        }
        if pos >= bytes.len() {
            break;
        }

        // 値を読む
        let value = if bytes[pos] == b'{' {
            pos += 1;
            let vstart = pos;
            let mut depth = 1usize;
            while pos < bytes.len() {
                match bytes[pos] {
                    b'{' => depth += 1,
                    b'}' => {
                        depth -= 1;
                        if depth == 0 {
                            break;
                        }
                    }
                    _ => {}
                }
                pos += 1;
            }
            let v = text[vstart..pos].trim().to_string();
            pos += 1; // skip '}'
            v
        } else if bytes[pos] == b'"' {
            pos += 1;
            let vstart = pos;
            while pos < bytes.len() && bytes[pos] != b'"' {
                pos += 1;
            }
            let v = text[vstart..pos].trim().to_string();
            pos += 1; // skip '"'
            v
        } else {
            // 裸の数値など
            let vstart = pos;
            while pos < bytes.len()
                && bytes[pos] != b','
                && bytes[pos] != b'\n'
            {
                pos += 1;
            }
            text[vstart..pos].trim().to_string()
        };

        if !name.is_empty() {
            fields.insert(name, value);
        }
    }

    fields
}

// ─── 類似度 ───────────────────────────────────────────────────────────────────

/// ノート内容と論文テキストの簡易 Jaccard 類似度（長さ 3 以上の単語で計算）
pub fn keyword_similarity(note: &str, paper: &str) -> f32 {
    fn words(s: &str) -> HashSet<String> {
        s.split(|c: char| !c.is_alphanumeric())
            .filter(|w| w.len() >= 3)
            .map(|w| w.to_lowercase())
            .collect()
    }

    let note_words = words(note);
    let paper_words = words(paper);

    if note_words.is_empty() || paper_words.is_empty() {
        return 0.0;
    }

    let intersection = note_words.intersection(&paper_words).count();
    let union = note_words.union(&paper_words).count();

    if union == 0 {
        0.0
    } else {
        intersection as f32 / union as f32
    }
}
