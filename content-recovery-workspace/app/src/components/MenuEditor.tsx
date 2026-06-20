import { type MenuItem } from "../menuItems";

type Props = {
  items: MenuItem[];
  onChange: (items: MenuItem[]) => void;
  label: string;
};

export function MenuEditor({ items, onChange, label }: Props) {
  function update(index: number, patch: Partial<MenuItem>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function addItem() {
    onChange([...items, { label: "", url: "" }]);
  }

  function remove(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function move(index: number, direction: -1 | 1) {
    const next = index + direction;
    if (next < 0 || next >= items.length) {
      return;
    }
    const copy = [...items];
    [copy[index], copy[next]] = [copy[next], copy[index]];
    onChange(copy);
  }

  return (
    <div className="mt-2 space-y-3">
      <p className="text-xs text-slate-500">
        Edit {label.toLowerCase()} links. Changes save automatically and update the menu HTML.
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No menu links yet.</p>
      ) : (
        items.map((item, index) => (
          <div
            key={`menu-${index}`}
            className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/40"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="rounded bg-brand-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-brand-800 dark:bg-brand-900/40 dark:text-brand-200">
                Link {index + 1}
              </span>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="text-slate-500 hover:text-slate-800 disabled:opacity-30 dark:hover:text-slate-200"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                  className="text-slate-500 hover:text-slate-800 disabled:opacity-30 dark:hover:text-slate-200"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  className="text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs text-slate-500">
                Label
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
                  value={item.label}
                  onChange={(e) => update(index, { label: e.target.value })}
                  placeholder="e.g. Kontakt"
                />
              </label>
              <label className="block text-xs text-slate-500">
                URL
                <input
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs dark:border-slate-600 dark:bg-slate-800"
                  value={item.url}
                  onChange={(e) => update(index, { url: e.target.value })}
                  placeholder="e.g. /kontakt/"
                />
              </label>
            </div>
          </div>
        ))
      )}
      <button
        type="button"
        onClick={addItem}
        className="text-sm font-medium text-brand-600 hover:underline"
      >
        + Add menu link
      </button>
    </div>
  );
}
