//! 物理メモリに対する割合でプロセスの使用上限を抑える（Unix は RLIMIT_AS、全 OS でロード前チェック）。

use std::path::Path;

use sysinfo::{Pid, ProcessesToUpdate, System};

/// 設定値を有効範囲に収める。0 以下は「上限なし」。
pub fn clamp_fraction(f: f64) -> f64 {
    if f <= 0.0 {
        0.0
    } else {
        f.clamp(0.0, 1.0)
    }
}

fn total_physical_bytes() -> u64 {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.total_memory()
}

fn this_process_virtual_memory_bytes() -> u64 {
    let mut sys = System::new();
    let pid = Pid::from_u32(std::process::id());
    sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    sys
        .process(pid)
        .map(|p| p.virtual_memory())
        .unwrap_or(0)
}

/// モデル mmap と推論用バッファの粗い見積もり（RLIMIT_AS は仮想メモリ基準のため VM で揃える）。
///
/// 注意: 実測値に完全一致させるのは難しいため、現実的な安全側の係数を
/// `model_path`（量子化種別・モデル世代）から推定して使います。
fn estimated_extra_bytes_for_gguf(model_file_len: u64, model_path: &Path) -> u64 {
    let model_str = model_path.to_string_lossy();

    // weights（モデル本体）に対する係数。量子化が重いほど大きくなる想定。
    // KVはモデル世代（1B vs 270m）と推論中の一時バッファなどに依存するため、
    // ここでは安全側に上限寄りで固定値を割り当てる。
    let (weight_mul_num, weight_mul_den, kv_headroom_bytes): (u64, u64, u64) = {
        if model_str.contains("gemma-3-270m-it-Q4_K_M") {
            (18, 10, 320 * 1024 * 1024) // 約1.8倍 + KV小さめ
        } else if model_str.contains("gemma-3-270m-it-Q6_K") {
            (20, 10, 384 * 1024 * 1024) // 約2.0倍 + KV標準
        } else if model_str.contains("gemma-3-270m-it-Q8_0") {
            (26, 10, 448 * 1024 * 1024) // 約2.6倍 + KV大きめ
        } else if model_str.contains("gemma-3-270m-it-F16") {
            (34, 10, 512 * 1024 * 1024) // 約3.4倍 + KVさらに大きめ
        } else if model_str.contains("gemma-3-1b-it-q4_0") {
            // 1B は 270m より大きいので KV を厚めに見る
            (22, 10, 512 * 1024 * 1024) // 約2.2倍 + KV厚め
        } else {
            // フォールバック（旧挙動に近い）
            (2, 1, 384 * 1024 * 1024)
        }
    };

    // (a * num) / den を u128 で安全に計算
    let weight_part = ((model_file_len as u128) * (weight_mul_num as u128) / (weight_mul_den as u128)) as u64;
    weight_part.saturating_add(kv_headroom_bytes)
}

/// `fraction` が (0, 1] のとき、現在の使用量 + 見積もりが「総物理メモリ × fraction」を超えないか確認する。
pub fn check_model_load_allowed(fraction: f64, model_path: &Path) -> Result<(), String> {
    let fraction = clamp_fraction(fraction);
    if fraction <= 0.0 {
        return Ok(());
    }

    let total = total_physical_bytes();
    if total == 0 {
        return Ok(());
    }

    let cap = ((total as f64) * fraction).floor() as u64;
    let meta = std::fs::metadata(model_path)
        .map_err(|e| format!("モデルファイルのメタデータ取得に失敗: {}", e))?;
    let file_len = meta.len();

    let current_vm = this_process_virtual_memory_bytes();
    let projected = current_vm.saturating_add(estimated_extra_bytes_for_gguf(file_len, model_path));

    if projected > cap {
        return Err(format!(
            "メモリ上限（物理メモリの約{}%、上限 {} MB）を超える見込みのため、モデルを読み込めません。\
             現在の使用量の目安 {} MB、モデル読み込み後の見積もり {} MB。\
             `config.toml` の [performance] max_system_memory_fraction を下げるか 0 で無効化、または ignore_memory_budget を true にしてください。",
            (fraction * 100.0) as u32,
            cap / 1024 / 1024,
            current_vm / 1024 / 1024,
            projected / 1024 / 1024
        ));
    }

    Ok(())
}

/// Unix: 仮想アドレス空間の上限を物理メモリの `fraction` に合わせる（ベストエフォート）。
pub fn apply_optional_address_space_limit(fraction: f64) {
    let fraction = clamp_fraction(fraction);
    if fraction <= 0.0 {
        return;
    }

    #[cfg(unix)]
    {
        use libc::{getrlimit, rlimit, setrlimit, RLIMIT_AS, RLIM_INFINITY};

        let total = total_physical_bytes();
        if total == 0 {
            return;
        }

        let cap = ((total as f64) * fraction).floor().max(1.0) as u64;
        let cap_rlim = cap.min(i64::MAX as u64) as libc::rlim_t;

        unsafe {
            let mut cur: rlimit = std::mem::zeroed();
            if getrlimit(RLIMIT_AS, &mut cur) != 0 {
                eprintln!("[memory_budget] getrlimit(RLIMIT_AS) に失敗したため上限を設定しません");
                return;
            }

            let hard_limit = if cur.rlim_max == RLIM_INFINITY {
                cap_rlim
            } else {
                cur.rlim_max.min(cap_rlim)
            };

            if hard_limit == 0 {
                return;
            }

            let new = rlimit {
                rlim_cur: hard_limit,
                rlim_max: hard_limit,
            };

            if setrlimit(RLIMIT_AS, &new) != 0 {
                eprintln!(
                    "[memory_budget] setrlimit(RLIMIT_AS, {} MB) に失敗（権限・既存上限など）。ロード前チェックのみ有効です。",
                    hard_limit as u64 / 1024 / 1024
                );
            }
        }
    }
}

/// Unix: `RLIMIT_AS` を（可能な範囲で）無制限に戻す。
/// `ignore_memory_budget=true` を起動後に切り替えた場合でも、ロード前に上限を解除したいケース向け。
#[cfg(unix)]
pub fn disable_address_space_limit() {
    use libc::{getrlimit, rlimit, setrlimit, RLIMIT_AS, RLIM_INFINITY};

    unsafe {
        let mut cur: rlimit = std::mem::zeroed();
        if getrlimit(RLIMIT_AS, &mut cur) != 0 {
            eprintln!("[memory_budget] getrlimit(RLIMIT_AS) に失敗したため RLIMIT_AS 無効化をしません");
            return;
        }

        // リミットが既に無制限っぽい場合は何もしない
        if cur.rlim_cur == RLIM_INFINITY && cur.rlim_max == RLIM_INFINITY {
            return;
        }

        let new = rlimit {
            rlim_cur: RLIM_INFINITY,
            rlim_max: RLIM_INFINITY,
        };

        if setrlimit(RLIMIT_AS, &new) != 0 {
            eprintln!("[memory_budget] setrlimit(RLIMIT_AS=unlimited) に失敗しました（権限・既存上限など）。ロード前チェックのみ無効化されます。");
        }
    }
}

#[cfg(not(unix))]
pub fn disable_address_space_limit() {
    // 他OSでは現状未対応
}
