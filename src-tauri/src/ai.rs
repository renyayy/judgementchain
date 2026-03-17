/// AI バックエンド（llama.cpp ローカル推論 / Ollama フォールバック）

use std::num::NonZeroU32;
use std::path::{Path, PathBuf};

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{AddBos, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;

#[cfg(not(dev))]
use tauri::Manager;

pub const GEMMA_MODEL_FILENAME: &str = "gemma-3-1b-it-q4_0.gguf";

// ─── モデルパス ────────────────────────────────────────────────────────────────

/// バンドルされたモデルファイルのパスを返す。
/// - dev ビルド: `src-tauri/models/<filename>` を直接参照
/// - release ビルド: Tauri リソースディレクトリを参照
pub fn get_bundled_model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(dev)]
    {
        let _ = app;
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        return Ok(manifest_dir.join("models").join(GEMMA_MODEL_FILENAME));
    }
    #[cfg(not(dev))]
    {
        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("リソースディレクトリの取得に失敗しました: {}", e))?;
        Ok(resource_dir.join(GEMMA_MODEL_FILENAME))
    }
}

// ─── LlamaState ───────────────────────────────────────────────────────────────

/// llama.cpp バックエンドとロード済みモデルを保持する。
/// `AppState` の `Arc<Mutex<Option<LlamaState>>>` に格納して使う。
pub struct LlamaState {
    backend: LlamaBackend,
    model: LlamaModel,
}

// llama-cpp-2 の raw pointer ラッパーはスレッド間で安全に渡せる
unsafe impl Send for LlamaState {}
unsafe impl Sync for LlamaState {}

impl LlamaState {
    /// モデルファイルをロードして LlamaState を返す。
    /// 重いので spawn_blocking から呼ぶこと。
    pub fn load(model_path: &Path) -> Result<Self, String> {
        let backend = LlamaBackend::init()
            .map_err(|e| format!("llama backend 初期化失敗: {}", e))?;

        let model_params = LlamaModelParams::default();
        let model = LlamaModel::load_from_file(&backend, model_path, &model_params)
            .map_err(|e| format!("モデル読み込み失敗: {}", e))?;

        Ok(Self { backend, model })
    }

    /// プロンプトを渡してテキストを生成する。
    /// `on_token`: 各トークン生成時に呼ばれるコールバック（ストリーミング用）
    pub fn generate(
        &self,
        prompt: &str,
        max_tokens: u32,
        on_token: impl Fn(&str),
    ) -> Result<String, String> {
        let ctx_params = LlamaContextParams::default()
            .with_n_ctx(NonZeroU32::new(2048));

        let mut ctx = self
            .model
            .new_context(&self.backend, ctx_params)
            .map_err(|e| format!("コンテキスト作成失敗: {}", e))?;

        // トークン化
        let tokens_list = self
            .model
            .str_to_token(prompt, AddBos::Always)
            .map_err(|e| format!("トークン化失敗: {}", e))?;

        let n_prompt = tokens_list.len() as i32;
        let mut batch = LlamaBatch::new(512, 1);

        for (i, &token) in tokens_list.iter().enumerate() {
            let is_last = i == tokens_list.len() - 1;
            batch
                .add(token, i as i32, &[0], is_last)
                .map_err(|e| format!("バッチ追加失敗: {}", e))?;
        }

        ctx.decode(&mut batch)
            .map_err(|e| format!("プロンプトデコード失敗: {}", e))?;

        let mut n_cur = n_prompt;
        let mut output = String::new();
        let mut sampler = LlamaSampler::greedy();
        // UTF-8 デコーダーを再利用してマルチバイト文字を正しく処理する
        let mut decoder = encoding_rs::UTF_8.new_decoder();

        loop {
            // 次トークンをサンプリング（-1 = 最後のトークン位置）
            let new_token = sampler.sample(&ctx, -1);
            sampler.accept(new_token);

            // 終了条件
            if self.model.is_eog_token(new_token)
                || n_cur >= n_prompt + max_tokens as i32
            {
                break;
            }

            // トークンを文字列に変換してコールバック呼び出し
            if let Ok(piece) = self.model.token_to_piece(new_token, &mut decoder, false, None) {
                on_token(&piece);
                output.push_str(&piece);
            }

            // 次のステップへ
            batch.clear();
            batch
                .add(new_token, n_cur, &[0], true)
                .map_err(|e| format!("バッチ追加失敗: {}", e))?;
            ctx.decode(&mut batch)
                .map_err(|e| format!("デコード失敗: {}", e))?;

            n_cur += 1;
        }

        Ok(output)
    }
}

// ─── 矛盾検出 ─────────────────────────────────────────────────────────────────

/// 矛盾検出用のプロンプトを構築する（Gemma instruct フォーマット）。
pub fn build_contradiction_prompt(current: &str, other: &str) -> String {
    // 長いノートはトークン節約のため先頭 500 字に切り詰める
    let cur = current.chars().take(500).collect::<String>();
    let oth = other.chars().take(500).collect::<String>();
    format!(
        "<start_of_turn>user\n\
         現在のノート:\n{cur}\n\n\
         過去のノート:\n{oth}\n\n\
         これらのノートに矛盾がありますか？\
         「はい、矛盾があります：[理由を1文で]」または「いいえ、矛盾はありません」のどちらかで答えてください。\
         <end_of_turn>\n<start_of_turn>model\n"
    )
}

/// Gemma の出力から矛盾の説明を抽出する。
/// "はい、矛盾があります：..." → Some(description)
/// "いいえ..."                 → None
pub fn parse_contradiction_response(response: &str) -> Option<String> {
    let lower = response.trim().to_lowercase();
    if lower.starts_with("はい") || lower.starts_with("yes") || lower.contains("矛盾があります") {
        // コロン以降を説明として取り出す
        let desc = response
            .splitn(2, '：')
            .nth(1)
            .or_else(|| response.splitn(2, ':').nth(1))
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| response.trim().to_string());
        Some(desc)
    } else {
        None
    }
}

// ─── Ollama embedding (既存) ──────────────────────────────────────────────────

/// Ollama の /api/embed エンドポイントを呼び出してembeddingを返す。
/// Ollamaが起動していない場合は None を返す（非ブロッキング）。
pub fn embed_with_ollama(model: &str, text: &str) -> Option<Vec<f32>> {
    let url = "http://localhost:11434/api/embed";
    let body = format!(
        r#"{{"model":"{}","input":"{}"}}"#,
        model,
        text.replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
            .replace('\r', "")
    );

    let response = std::process::Command::new("curl")
        .args([
            "-s",
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-d",
            &body,
            "--connect-timeout",
            "3",
            "--max-time",
            "30",
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
    let json = json.trim();
    if let Some(start) = json.find("\"embeddings\":[[") {
        let after = &json[start + 15..];
        return parse_float_array(after);
    }
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
    if floats.is_empty() {
        None
    } else {
        Some(floats)
    }
}

/// テキストからembeddingを生成（backend設定に基づく）。
pub fn generate_embedding(backend: &str, model: &str, text: &str) -> Option<Vec<f32>> {
    match backend {
        "ollama" => embed_with_ollama(model, text),
        _ => None,
    }
}
