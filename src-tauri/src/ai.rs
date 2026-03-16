/// AI バックエンド（Ollama / フォールバック）

/// Ollama の /api/embed エンドポイントを呼び出してembeddingを返す。
/// Ollamaが起動していない場合は None を返す（非ブロッキング）。
pub fn embed_with_ollama(model: &str, text: &str) -> Option<Vec<f32>> {
    let url = "http://localhost:11434/api/embed";
    let body = format!(r#"{{"model":"{}","input":"{}"}}"#,
        model,
        text.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "")
    );

    let response = std::process::Command::new("curl")
        .args([
            "-s",
            "-X", "POST",
            "-H", "Content-Type: application/json",
            "-d", &body,
            "--connect-timeout", "3",
            "--max-time", "30",
            url,
        ])
        .output()
        .ok()?;

    if !response.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&response.stdout);
    parse_embedding_response(&text)
}

fn parse_embedding_response(json: &str) -> Option<Vec<f32>> {
    // {"embeddings":[[0.1, 0.2, ...]]}  (new API)
    // {"embedding":[0.1, 0.2, ...]}      (old API)
    let json = json.trim();

    // Try new format: "embeddings":[[...]]
    if let Some(start) = json.find("\"embeddings\":[[") {
        let after = &json[start + 15..];
        return parse_float_array(after);
    }

    // Try old format: "embedding":[...]
    if let Some(start) = json.find("\"embedding\":[") {
        let after = &json[start + 13..];
        return parse_float_array(after);
    }

    None
}

fn parse_float_array(s: &str) -> Option<Vec<f32>> {
    let end = s.find(']')?;
    let inner = &s[..end];
    let floats: Vec<f32> = inner
        .split(',')
        .filter_map(|x| x.trim().parse::<f32>().ok())
        .collect();
    if floats.is_empty() { None } else { Some(floats) }
}

/// テキストからembeddingを生成。backend設定に基づきOllamaを試行し、
/// 失敗時は空を返す（graceful degradation）。
pub fn generate_embedding(backend: &str, model: &str, text: &str) -> Option<Vec<f32>> {
    match backend {
        "ollama" => embed_with_ollama(model, text),
        _ => None,
    }
}
