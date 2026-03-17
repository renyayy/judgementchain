/// AI バックエンド（Candle + GGUF ローカル推論）

use std::path::{Path, PathBuf};
use candle_core::{Device, Tensor};
use candle_transformers::models::quantized_gemma3 as qgm;
use candle_core::quantized::gguf_file;
use tokenizers::Tokenizer;

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

// ─── CandleState ──────────────────────────────────────────────────────────────

/// Candle モデルとトークナイザを保持する。
/// `AppState` の `Arc<Mutex<Option<CandleState>>>` に格納して使う。
pub struct CandleState {
    model: qgm::ModelWeights,
    tokenizer: Tokenizer,
    device: Device,
    model_path: PathBuf,
}

unsafe impl Send for CandleState {}
unsafe impl Sync for CandleState {}

impl CandleState {
    /// GGUF モデルファイルをロードして CandleState を返す。
    /// 重いので spawn_blocking から呼ぶこと。
    pub fn load(model_path: &Path) -> Result<Self, String> {
        let tokenizer = Self::load_tokenizer(model_path)?;

        let gpu_device = Self::select_gpu_device();

        if let Some(device) = gpu_device {
            match Self::load_model(model_path, &device) {
                Ok(model) => {
                    return Ok(Self {
                        model,
                        tokenizer,
                        device,
                        model_path: model_path.to_path_buf(),
                    });
                }
                Err(e) => {
                    eprintln!("[ai] GPU でのモデル読み込み失敗 ({}), CPU にフォールバックします", e);
                }
            }
        }

        eprintln!("[ai] CPU を使用します");
        let device = Device::Cpu;
        let model = Self::load_model(model_path, &device)?;

        Ok(Self {
            model,
            tokenizer,
            device,
            model_path: model_path.to_path_buf(),
        })
    }

    fn select_gpu_device() -> Option<Device> {
        #[cfg(target_os = "linux")]
        {
            match Device::new_cuda(0) {
                Ok(device) => {
                    eprintln!("[ai] CUDA デバイスを検出しました");
                    return Some(device);
                }
                Err(e) => eprintln!("[ai] CUDA 初期化失敗: {}", e),
            }
        }
        #[cfg(target_os = "macos")]
        {
            match Device::new_metal(0) {
                Ok(device) => {
                    eprintln!("[ai] Metal デバイスを検出しました");
                    return Some(device);
                }
                Err(e) => eprintln!("[ai] Metal 初期化失敗: {}", e),
            }
        }
        None
    }

    fn load_model(model_path: &Path, device: &Device) -> Result<qgm::ModelWeights, String> {
        let mut file = std::fs::File::open(model_path)
            .map_err(|e| format!("モデルファイルを開けません: {}", e))?;
        let content = gguf_file::Content::read(&mut file)
            .map_err(|e| format!("GGUF読み込み失敗: {}", e))?;
        qgm::ModelWeights::from_gguf(content, &mut file, device)
            .map_err(|e| format!("モデル読み込み失敗: {}", e))
    }

    fn load_tokenizer(model_path: &Path) -> Result<Tokenizer, String> {
        // まずモデルと同じディレクトリの tokenizer.json を探す
        let dir = model_path.parent().unwrap_or(Path::new("."));
        let tokenizer_path = dir.join("tokenizer.json");
        
        if tokenizer_path.exists() {
            return Tokenizer::from_file(&tokenizer_path)
                .map_err(|e| format!("トークナイザ読み込み失敗: {}", e));
        }

        // Gemma 用のデフォルトトークナイザを HF Hub から取得
        let api = hf_hub::api::sync::Api::new()
            .map_err(|e| format!("HF API 初期化失敗: {}", e))?;
        let repo = api.model("google/gemma-3-1b-it".to_string());
        let tokenizer_file = repo.get("tokenizer.json")
            .map_err(|e| format!("トークナイザダウンロード失敗: {}", e))?;
        
        Tokenizer::from_file(&tokenizer_file)
            .map_err(|e| format!("トークナイザ読み込み失敗: {}", e))
    }

    /// モデルパスを返す。
    pub fn model_path(&self) -> &Path {
        &self.model_path
    }

    /// プロンプトを渡してテキストを生成する。
    /// `on_token`: 各トークン生成時に呼ばれるコールバック（ストリーミング用）
    pub fn generate(
        &mut self,
        prompt: &str,
        max_tokens: u32,
        on_token: impl Fn(&str),
    ) -> Result<String, String> {
        // トークン化
        let encoding = self.tokenizer
            .encode(prompt, true)
            .map_err(|e| format!("トークン化失敗: {}", e))?;
        
        let prompt_tokens = encoding.get_ids();
        let mut tokens: Vec<u32> = prompt_tokens.to_vec();
        
        let mut output = String::new();
        let mut stop_token_ids: Vec<u32> = Vec::new();
        for token_str in &["<eos>", "</s>", "<end_of_turn>", "<|endoftext|>"] {
            if let Some(id) = self.tokenizer.token_to_id(token_str) {
                stop_token_ids.push(id);
            }
        }
        if stop_token_ids.is_empty() {
            stop_token_ids.push(2);
        }

        let mut index_pos = 0usize;

        for _i in 0..max_tokens {
            let input_tokens = if index_pos == 0 {
                &tokens[..]
            } else {
                &tokens[tokens.len() - 1..]
            };

            let input = Tensor::new(input_tokens, &self.device)
                .map_err(|e| format!("テンソル作成失敗: {}", e))?
                .unsqueeze(0)
                .map_err(|e| format!("次元追加失敗: {}", e))?;

            let logits = self.model
                .forward(&input, index_pos)
                .map_err(|e| format!("推論失敗: {}", e))?;

            let logits = logits
                .squeeze(0)
                .map_err(|e| format!("squeeze失敗: {}", e))?;

            let next_token = logits
                .argmax(candle_core::D::Minus1)
                .map_err(|e| format!("argmax失敗: {}", e))?
                .to_scalar::<u32>()
                .map_err(|e| format!("スカラー変換失敗: {}", e))?;

            if stop_token_ids.contains(&next_token) {
                break;
            }

            index_pos += input_tokens.len();
            tokens.push(next_token);

            if let Ok(piece) = self.tokenizer.decode(&[next_token], false) {
                on_token(&piece);
                output.push_str(&piece);
            }
        }

        Ok(output)
    }
}

// ─── 週次サマリ ───────────────────────────────────────────────────────────────

/// 週次サマリ生成用プロンプト（Gemma instruct フォーマット）
/// `activity`: Vec<(ファイル名, アクセス回数)>
pub fn build_weekly_summary_prompt(week_label: &str, activity: &[(String, u32)]) -> String {
    let lines: String = activity
        .iter()
        .map(|(path, cnt)| {
            let name = std::path::Path::new(path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(path);
            format!("  - {}: {}回", name, cnt)
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "<start_of_turn>user\n\
         {}週のノート活動:\n{}\n\n\
         この活動傾向から、ユーザーの「強み（よく考えている分野）」と「改善点（手薄な分野）」を\
         それぞれ1〜2文の日本語で簡潔にまとめてください。\
         <end_of_turn>\n<start_of_turn>model\n",
        week_label, lines
    )
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
