use notify::{RecommendedWatcher, RecursiveMode, Watcher, Config as NotifyConfig};
use tauri::{AppHandle, Emitter};

pub fn start(app: AppHandle, vault_path: String) {
    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel();

        let mut watcher = match RecommendedWatcher::new(tx, NotifyConfig::default()) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("Failed to create watcher: {}", e);
                return;
            }
        };

        let path = crate::config::expand_tilde(&vault_path);
        if let Err(e) = watcher.watch(&path, RecursiveMode::Recursive) {
            eprintln!("Failed to watch vault: {}", e);
            return;
        }

        loop {
            match rx.recv() {
                Ok(Ok(event)) => {
                    use notify::EventKind;
                    match event.kind {
                        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_) => {
                            // Debounce: small sleep to batch rapid events
                            std::thread::sleep(std::time::Duration::from_millis(300));
                            // Drain any queued events
                            while rx.try_recv().is_ok() {}
                            let _ = app.emit("vault:changed", ());
                        }
                        _ => {}
                    }
                }
                Ok(Err(e)) => eprintln!("Watch error: {}", e),
                Err(_) => break,
            }
        }
    });
}
