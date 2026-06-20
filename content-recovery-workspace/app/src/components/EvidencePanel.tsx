import type { ContentObject } from "../types";

type Props = {
  object: ContentObject | null;
};

export function EvidencePanel({ object }: Props) {
  if (!object) {
    return (
      <aside className="w-80 shrink-0 border-l border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">
        Evidence and history appear here.
      </aside>
    );
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <section className="border-b border-slate-200 p-4 dark:border-slate-800">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sources</h2>
        <dl className="mt-2 space-y-2 text-sm">
          {object.evidence.length === 0 ? (
            <p className="text-slate-500">No evidence recorded.</p>
          ) : (
            object.evidence.map((ev) => (
              <div key={ev.id}>
                <dt className="font-medium text-slate-700 dark:text-slate-200">{ev.evidence_type}</dt>
                <dd className="break-all text-slate-600 dark:text-slate-400">{ev.value}</dd>
              </div>
            ))
          )}
        </dl>
      </section>

      <section className="border-b border-slate-200 p-4 dark:border-slate-800">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Metadata</h2>
        <dl className="mt-2 space-y-1 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Status</dt>
            <dd className="font-medium">{object.status}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Locale</dt>
            <dd>{object.locale}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-slate-500">Updated</dt>
            <dd className="text-right text-xs">{new Date(object.updated_at).toLocaleString()}</dd>
          </div>
          {object.approved_at ? (
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Approved</dt>
              <dd className="text-right text-xs">{new Date(object.approved_at).toLocaleString()}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Version history</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {object.versions.map((v) => (
            <li key={v.version_number} className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
              <div className="font-medium">v{v.version_number}</div>
              <div className="text-xs text-slate-500">
                {v.source} · {new Date(v.created_at).toLocaleString()}
              </div>
              {v.change_note ? <div className="mt-1 text-xs">{v.change_note}</div> : null}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
