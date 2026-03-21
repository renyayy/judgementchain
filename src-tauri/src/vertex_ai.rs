use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

// --- サービスアカウントJSON構造 ---
#[derive(Debug, Deserialize)]
struct ServiceAccount {
    client_email: String,
    private_key: String,
}

// --- JWT Claims ---
#[derive(Debug, Serialize)]
struct JwtClaims {
    iss: String,
    scope: String,
    aud: String,
    iat: u64,
    exp: u64,
}

// --- Googleトークンレスポンス ---
#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
}

// --- Vertex AI リクエスト/レスポンス ---
#[derive(Debug, Serialize)]
struct GeminiRequest {
    contents: Vec<GeminiContent>,
    #[serde(rename = "generationConfig")]
    generation_config: GenerationConfig,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeminiContent {
    role: String,
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Serialize, Deserialize)]
struct GeminiPart {
    // ストリーミングのchunkでは `thoughtSignature` のみ等で `text` が空/欠落することがあるため、
    // 欠落してもデシリアライズが落ちないようデフォルト値を持たせる。
    #[serde(default)]
    text: String,
}

#[derive(Debug, Serialize)]
struct GenerationConfig {
    #[serde(rename = "responseMimeType")]
    response_mime_type: String,
    temperature: f32,
    #[serde(rename = "maxOutputTokens")]
    max_output_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct GeminiResponse {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: GeminiContent,
}

/// サービスアカウントJSON文字列からGoogleアクセストークンを取得する
pub async fn get_access_token(service_account_json: &str) -> Result<String, String> {
    let sa: ServiceAccount = serde_json::from_str(service_account_json)
        .map_err(|e| format!("サービスアカウントJSONパースエラー: {}", e))?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let claims = JwtClaims {
        iss: sa.client_email.clone(),
        scope: "https://www.googleapis.com/auth/cloud-platform".to_string(),
        aud: "https://oauth2.googleapis.com/token".to_string(),
        iat: now,
        exp: now + 3600,
    };

    // PEM形式の秘密鍵をパース（PKCS8）
    let private_key_pem = sa.private_key.replace("\\n", "\n");
    let encoding_key = EncodingKey::from_rsa_pem(private_key_pem.as_bytes())
        .map_err(|e| format!("RSA秘密鍵パースエラー: {}", e))?;

    let header = Header::new(Algorithm::RS256);
    let jwt = encode(&header, &claims, &encoding_key)
        .map_err(|e| format!("JWT署名エラー: {}", e))?;

    // GoogleのOAuth2エンドポイントでトークンを取得
    let client = reqwest::Client::new();
    let params = [
        ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
        ("assertion", &jwt),
    ];

    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("トークン取得HTTPエラー: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("トークン取得失敗 ({}): {}", status, body));
    }

    let token_resp: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("トークンレスポンスパースエラー: {}", e))?;

    Ok(token_resp.access_token)
}

// https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/global/publishers/google/models/${MODEL_ID}:streamGenerateContent
/// Gemini APIを呼び出してテキストを返す
pub async fn call_gemini(
    access_token: &str,
    project_id: &str,
    _location: &str,
    model: &str,
    prompt: &str,
) -> Result<String, String> {
    let url = format!(
        "https://aiplatform.googleapis.com/v1/projects/{project_id}/locations/global/publishers/google/models/{model}:streamGenerateContent",
        project_id = project_id,
        model = model,
    );

    let request_body = GeminiRequest {
        contents: vec![GeminiContent {
            role: "user".to_string(),
            parts: vec![GeminiPart {
                text: prompt.to_string(),
            }],
        }],
        generation_config: GenerationConfig {
            response_mime_type: "application/json".to_string(),
            temperature: 0.1,
            max_output_tokens: 8192,
        },
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(access_token)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Gemini API HTTPエラー: {}", e))?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();

    // デバッグ用: レスポンスをそのまま出力（パース失敗の原因特定用）
    eprintln!(
        "--- GEMINI RAW RESPONSE START ---\n{}\n--- GEMINI RAW RESPONSE END ---",
        body_text
    );

    if !status.is_success() {
        return Err(format!("Gemini API失敗 ({}): {}", status, body_text));
    }

    // `streamGenerateContent` は chunk 配列（JSON array）として返ってくることがあるため、
    // 受け取ったレスポンスが配列/オブジェクトどちらでもパースできるようにする。
    let trimmed = body_text.trim_start();
    let mut acc = String::new();

    if trimmed.starts_with('[') {
        let chunks: Vec<GeminiResponse> = serde_json::from_str(&body_text).map_err(|e| {
            format!(
                "Geminiレスポンスパースエラー(配列): {} / レスポンス: {}",
                e, body_text
            )
        })?;

        for chunk in chunks {
            if let Some(candidate) = chunk.candidates.into_iter().next() {
                for part in candidate.content.parts {
                    acc.push_str(&part.text);
                }
            }
        }
    } else {
        let gemini_resp: GeminiResponse = serde_json::from_str(&body_text).map_err(|e| {
            format!(
                "Geminiレスポンスパースエラー(オブジェクト): {} / レスポンス: {}",
                e, body_text
            )
        })?;

        for candidate in gemini_resp.candidates {
            for part in candidate.content.parts {
                acc.push_str(&part.text);
            }
        }
    }

    if acc.is_empty() {
        return Err("Geminiからのレスポンスが空です".to_string());
    }

    Ok(acc)
}

/// テキスト生成用 Gemini API呼び出し（JSON形式ではなくプレーンテキストを返す）
pub async fn call_gemini_text(
    access_token: &str,
    project_id: &str,
    _location: &str,
    model: &str,
    prompt: &str,
    max_output_tokens: u32,
) -> Result<String, String> {
    let url = format!(
        "https://aiplatform.googleapis.com/v1/projects/{project_id}/locations/global/publishers/google/models/{model}:streamGenerateContent",
        project_id = project_id,
        model = model,
    );

    let request_body = GeminiRequest {
        contents: vec![GeminiContent {
            role: "user".to_string(),
            parts: vec![GeminiPart {
                text: prompt.to_string(),
            }],
        }],
        generation_config: GenerationConfig {
            response_mime_type: "text/plain".to_string(),
            temperature: 0.1,
            max_output_tokens,
        },
    };

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .bearer_auth(access_token)
        .json(&request_body)
        .send()
        .await
        .map_err(|e| format!("Gemini API HTTPエラー: {}", e))?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!("Gemini API失敗 ({}): {}", status, body_text));
    }

    let trimmed = body_text.trim_start();
    let mut acc = String::new();

    if trimmed.starts_with('[') {
        let chunks: Vec<GeminiResponse> = serde_json::from_str(&body_text).map_err(|e| {
            format!("Geminiレスポンスパースエラー(配列): {}", e)
        })?;
        for chunk in chunks {
            if let Some(candidate) = chunk.candidates.into_iter().next() {
                for part in candidate.content.parts {
                    acc.push_str(&part.text);
                }
            }
        }
    } else {
        let gemini_resp: GeminiResponse = serde_json::from_str(&body_text).map_err(|e| {
            format!("Geminiレスポンスパースエラー(オブジェクト): {}", e)
        })?;
        for candidate in gemini_resp.candidates {
            for part in candidate.content.parts {
                acc.push_str(&part.text);
            }
        }
    }

    if acc.is_empty() {
        return Err("Geminiからのレスポンスが空です".to_string());
    }

    Ok(acc)
}

/// JSON文字列からコードブロックを除去してパース用に正規化する
pub fn clean_json_response(text: &str) -> &str {
    let text = text.trim();
    // ```json ... ``` または ``` ... ``` を除去
    if let Some(stripped) = text.strip_prefix("```json") {
        if let Some(inner) = stripped.strip_suffix("```") {
            return inner.trim();
        }
    }
    if let Some(stripped) = text.strip_prefix("```") {
        if let Some(inner) = stripped.strip_suffix("```") {
            return inner.trim();
        }
    }
    text
}

// base64モジュールは認証フローで内部的に使用（直接の#[allow(unused)]回避用）
fn _use_base64() {
    let _ = URL_SAFE_NO_PAD.encode(b"test");
}
