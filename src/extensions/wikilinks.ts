import { MatchDecorator, ViewPlugin, DecorationSet, EditorView, ViewUpdate, Decoration } from "@codemirror/view";

const wikilinkMark = (linkText: string) =>
  Decoration.mark({
    class: "cm-wikilink",
    attributes: { "data-link": linkText },
  });

const wikilinkDecorator = new MatchDecorator({
  regexp: /\[\[([^\[\]\n]+)\]\]/g,
  decoration: (match) => wikilinkMark(match[1]),
});

export const wikilinkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = wikilinkDecorator.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = wikilinkDecorator.updateDeco(update, this.decorations);
    }
  },
  { decorations: (v) => v.decorations }
);

export function wikilinkClickHandler(onNavigate: (link: string) => void) {
  return EditorView.domEventHandlers({
    mousedown(event) {
      const target = event.target as HTMLElement;
      const el = target.classList.contains("cm-wikilink")
        ? target
        : (target.closest(".cm-wikilink") as HTMLElement | null);
      if (el) {
        event.preventDefault();
        const link = el.dataset.link ?? el.textContent?.replace(/^\[\[|\]\]$/g, "") ?? "";
        if (link) onNavigate(link);
        return true;
      }
      return false;
    },
  });
}
