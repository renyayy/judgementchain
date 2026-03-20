import { useEffect, useMemo, useRef, useState } from "react";
import { usePluginRegistry } from "../plugins/registry";
import type { PluginCommandRegistration } from "../plugins/types";

function normalize(s: string) {
  return s.trim().toLowerCase();
}

export function CommandPalette() {
  const { commands: pluginCommands, reload } = usePluginRegistry();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const builtInCommands: PluginCommandRegistration[] = useMemo(
    () => [
      {
        id: "builtin:plugins.reload",
        name: "Plugins: Reload",
        callback: async () => {
          await reload();
        },
      },
    ],
    [reload],
  );

  const allCommands = useMemo(() => [...builtInCommands, ...pluginCommands], [builtInCommands, pluginCommands]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return allCommands;
    return allCommands.filter((c) => normalize(c.name).includes(q));
  }, [allCommands, query]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length, open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[selectedIndex];
        if (cmd) void Promise.resolve(cmd.callback()).finally(() => setOpen(false));
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, filtered, selectedIndex]);

  if (!open) return null;

  return (
    <div className="command-palette-overlay" onMouseDown={() => setOpen(false)}>
      <div className="command-palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-palette-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type a command..."
        />
        <div className="command-palette-list">
          {filtered.length === 0 && <div className="command-palette-empty">No commands</div>}
          {filtered.map((c, i) => (
            <div
              key={c.id}
              className={`command-palette-item ${i === selectedIndex ? "active" : ""}`}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={() => void Promise.resolve(c.callback()).finally(() => setOpen(false))}
            >
              {c.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

