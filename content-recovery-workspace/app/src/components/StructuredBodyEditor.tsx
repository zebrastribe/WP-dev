import { useEffect, useState } from "react";
import {
  type BodyBlock,
  blocksToHeadings,
  blocksToHtml,
  blocksToPlainText,
  htmlToBlocks,
  labelForBlock,
} from "../bodyBlocks";

type Props = {
  bodyHtml: string;
  onChange: (update: { body_html: string; body_text: string; headings: ReturnType<typeof blocksToHeadings> }) => void;
};

export function StructuredBodyEditor({ bodyHtml, onChange }: Props) {
  const [blocks, setBlocks] = useState<BodyBlock[]>(() => htmlToBlocks(bodyHtml));
  const [htmlKey, setHtmlKey] = useState(bodyHtml);

  useEffect(() => {
    if (bodyHtml !== htmlKey) {
      setBlocks(htmlToBlocks(bodyHtml));
      setHtmlKey(bodyHtml);
    }
  }, [bodyHtml, htmlKey]);

  function emit(next: BodyBlock[]) {
    setBlocks(next);
    onChange({
      body_html: blocksToHtml(next),
      body_text: blocksToPlainText(next),
      headings: blocksToHeadings(next),
    });
  }

  function updateBlock(id: string, patch: Partial<BodyBlock>) {
    emit(
      blocks.map((b) => {
        if (b.id !== id) return b;
        return { ...b, ...patch } as BodyBlock;
      }),
    );
  }

  function updateListItem(blockId: string, index: number, value: string) {
    emit(
      blocks.map((b) => {
        if (b.id !== blockId || (b.type !== "ul" && b.type !== "ol")) return b;
        const items = [...b.items];
        items[index] = value;
        return { ...b, items };
      }),
    );
  }

  function addListItem(blockId: string) {
    emit(
      blocks.map((b) => {
        if (b.id !== blockId || (b.type !== "ul" && b.type !== "ol")) return b;
        return { ...b, items: [...b.items, ""] };
      }),
    );
  }

  function removeBlock(id: string) {
    emit(blocks.filter((b) => b.id !== id));
  }

  if (blocks.length === 0) {
    return (
      <p className="mt-2 text-sm text-slate-500">
        No structured content parsed. Switch to HTML source to edit raw markup.
      </p>
    );
  }

  return (
    <div className="mt-2 space-y-3">
      {blocks.map((block) => (
        <div
          key={block.id}
          className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                block.type.startsWith("h")
                  ? "bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-200"
                  : block.type === "ul" || block.type === "ol"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                    : block.type === "img"
                      ? "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200"
                      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
              }`}
            >
              {labelForBlock(block.type)}
            </span>
            <button
              type="button"
              onClick={() => removeBlock(block.id)}
              className="text-xs text-red-600 hover:underline"
            >
              Remove
            </button>
          </div>

          {block.type === "img" ? (
            <div className="space-y-2">
              <div className="overflow-hidden rounded border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-800">
                <img
                  src={block.src}
                  alt={block.alt || "Content image"}
                  className="mx-auto max-h-48 max-w-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
              <label className="block text-xs text-slate-500">
                Alt text
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
                  value={block.alt}
                  onChange={(e) => updateBlock(block.id, { alt: e.target.value })}
                />
              </label>
              <label className="block text-xs text-slate-500">
                Image URL
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs dark:border-slate-600 dark:bg-slate-800"
                  value={block.src}
                  onChange={(e) => updateBlock(block.id, { src: e.target.value })}
                />
              </label>
            </div>
          ) : block.type === "ul" || block.type === "ol" ? (
            <div className="space-y-2">
              {block.items.map((item, index) => (
                <div key={`${block.id}-${index}`} className="flex gap-2">
                  <span className="pt-2 text-xs text-slate-400">{block.type === "ol" ? `${index + 1}.` : "•"}</span>
                  <textarea
                    className="min-h-[2.5rem] flex-1 rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
                    rows={2}
                    value={item}
                    onChange={(e) => updateListItem(block.id, index, e.target.value)}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => addListItem(block.id)}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                + Add list item
              </button>
            </div>
          ) : block.type === "p" || block.type === "h2" || block.type === "h3" || block.type === "h4" || block.type === "h5" || block.type === "h6" ? (
            <textarea
              className={`w-full rounded border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 ${
                block.type.startsWith("h") ? "font-semibold" : ""
              }`}
              rows={block.type.startsWith("h") ? 2 : 4}
              value={block.text}
              onChange={(e) => updateBlock(block.id, { text: e.target.value })}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
