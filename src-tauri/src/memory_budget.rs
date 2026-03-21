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

fn this_process_rss_bytes() -> u64 {
    let mut sys = System::new();
    let pid = Pid::from_u32(std::process::id());
    sys.refresh_processes(ProcessesToUpdate::Some(&[pid]), true);
    sys
        .process(pid)
        .map(|p| p.memory())
        .unwrap_or(0)
}

/// モデル mmap と推論用バッファの粗い見積もり。
fn estimated_extra_bytes_for_gguf(model_file_len: u64) -> u64 {
    const KV_HEADROOM: u64 = 384 * 1024 * 1024;
    model_file_len.saturating_mul(2).saturating_add(KV_HEADROOM)
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

    let current_rss = this_process_rss_bytes();
    let projected = current_rss.saturating_add(estimated_extra_bytes_for_gguf(file_len));

    if projected > cap {
        return Err(format!(
            "メモリ上限（物理メモリの約{}%、上限 {} MB）を超える見込みのため、モデルを読み込めません。\
             現在の使用量の目安 {} MB、モデル読み込み後の見積もり {} MB。\
             `config.toml` の [performance] max_system_memory_fraction を下げるか 0 で無効化できます。",
            (fraction * 100.0) as u32,
            cap / 1024 / 1024,
            current_rss / 1024 / 1024,
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
