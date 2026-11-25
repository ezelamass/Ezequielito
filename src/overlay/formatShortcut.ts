const LABELS: Record<string, string> = {
  ctrl: "Ctrl",
  control: "Ctrl",
  alt: "Alt",
  option: "⌥",
  shift: "Shift",
  cmd: "⌘",
  command: "⌘",
  super: "Win",
  win: "Win",
  meta: "Win",
  space: "Space",
  enter: "Enter",
  escape: "Esc",
};

/**
 * Turns a stored binding ("ctrl+space", "option+shift+f1") into a label a
 * person reads ("Ctrl + Space", "⌥ + Shift + F1"). Empty in, empty out.
 */
export function formatShortcut(binding: string): string {
  return binding
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const known = LABELS[part.toLowerCase()];
      if (known) return known;
      return part.length === 1
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" + ");
}
