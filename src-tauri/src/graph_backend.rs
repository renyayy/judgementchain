use async_trait::async_trait;

/// グラフ分析のLLMバックエンドを抽象化するtrait
#[async_trait]
pub trait GraphBackend: Send + Sync {
    /// プロンプトを送り、テキスト応答を返す
    async fn query(&self, prompt: &str) -> Result<String, String>;
}

/// Claude CLI (`claude -p`) を使うバックエンド
pub struct ClaudeCliBackend;

#[async_trait]
impl GraphBackend for ClaudeCliBackend {
    async fn query(&self, prompt: &str) -> Result<String, String> {
        let output = tokio::process::Command::new("claude")
            .args(["-p", prompt, "--output-format", "text"])
            .output()
            .await
            .map_err(|e| format!("claude CLI実行エラー: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("claude CLI失敗: {}", stderr));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    }
}

/// Vertex AI (Gemini API) を使うバックエンド（後方互換）
pub struct VertexAiBackend {
    pub access_token: String,
    pub project_id: String,
    pub location: String,
    pub model: String,
}

#[async_trait]
impl GraphBackend for VertexAiBackend {
    async fn query(&self, prompt: &str) -> Result<String, String> {
        crate::vertex_ai::call_gemini(
            &self.access_token,
            &self.project_id,
            &self.location,
            &self.model,
            prompt,
        )
        .await
    }
}
