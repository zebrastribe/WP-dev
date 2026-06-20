import { useEffect, useState } from "react";
import {
  blocksToHeadings,
  blocksToPlainText,
  htmlToBlocks,
  normalizeBodyHtml,
  type HeadingsMap,
} from "../bodyBlocks";
import { menuPayloadFromItems, normalizeMenuItems, type MenuItem } from "../menuItems";
import type { ContentObject, ObjectStatus } from "../types";
import { MenuEditor } from "./MenuEditor";
import { StructuredBodyEditor } from "./StructuredBodyEditor";

const STATUSES: ObjectStatus[] = [
  "recovered",
  "needs_review",
  "edited",
  "reviewed",
  "approved",
  "excluded",
];

type Props = {
  object: ContentObject | null;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
  saving: boolean;
  lastSaved?: string;
};

export function Editor({ object, onSave, saving, lastSaved }: Props) {
  const [title, setTitle] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [headings, setHeadings] = useState<HeadingsMap>({});
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [status, setStatus] = useState<ObjectStatus>("recovered");
  const [seoTitle, setSeoTitle] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [showSource, setShowSource] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const isService = object?.object_type === "service";
  const isGlobal = object?.object_type === "header" || object?.object_type === "footer";
  const templatePart = object?.object_type === "header" ? "header" : "footer";

  useEffect(() => {
    if (!object) return;
    setTitle(object.title ?? "");
    const rawHtml = (object.payload.body_html as string) ?? "";
    const normalized = normalizeBodyHtml(rawHtml);
    const blocks = htmlToBlocks(normalized);
    setBodyHtml(normalized);
    setBodyText(blocks.length > 0 ? blocksToPlainText(blocks) : ((object.payload.body_text as string) ?? ""));
    setHeadings(blocks.length > 0 ? blocksToHeadings(blocks) : ((object.payload.headings as HeadingsMap) ?? {}));
    setMenuItems(normalizeMenuItems(object.payload.menu_items));
    setStatus(object.status);
    setSeoTitle(object.seo?.seo_title ?? "");
    setMetaDescription(object.seo?.meta_description ?? "");
    setShowSource(false);
    setLoadedId(object.id);
  }, [object?.id]);

  function menuPayload(items: MenuItem[]) {
    if (!isGlobal) {
      return {};
    }
    return menuPayloadFromItems(items, templatePart as "header" | "footer");
  }

  function buildPayload() {
    if (isGlobal) {
      return menuPayload(menuItems);
    }
    return {
      body_html: bodyHtml,
      body_text: bodyText,
      headings,
      h2s: headings.h2 ?? [],
    };
  }

  function handleMenuChange(items: MenuItem[]) {
    setMenuItems(items);
    const payload = menuPayloadFromItems(items, templatePart as "header" | "footer");
    setBodyHtml(payload.body_html);
    setBodyText(payload.body_text);
  }

  function toggleHtmlSource() {
    if (showSource) {
      if (isGlobal) {
        setMenuItems(normalizeMenuItems(object?.payload.menu_items));
      } else {
        const normalized = normalizeBodyHtml(bodyHtml);
        const blocks = htmlToBlocks(normalized);
        setBodyHtml(normalized);
        setBodyText(blocksToPlainText(blocks));
        setHeadings(blocksToHeadings(blocks));
      }
    } else if (!isGlobal) {
      setBodyHtml(normalizeBodyHtml(bodyHtml));
    }
    setShowSource((v) => !v);
  }

  useEffect(() => {
    if (!object || loadedId !== object.id) return;
    const timer = window.setTimeout(() => {
      void onSave({
        title,
        status,
        payload: buildPayload(),
        seo: { seo_title: seoTitle, meta_description: metaDescription },
      });
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [
    title,
    bodyHtml,
    bodyText,
    headings,
    menuItems,
    status,
    seoTitle,
    metaDescription,
    object?.id,
    loadedId,
    onSave,
    isGlobal,
  ]);

  if (!object) {
    return (
      <main className="flex flex-1 items-center justify-center p-8 text-slate-500">
        Select content from the sidebar to edit.
      </main>
    );
  }

  const pageSlugs = (object.payload.page_slugs as string[] | undefined) ?? [];
  const wasLoader = Boolean(object.payload.title_was_loader);
  const menuLabel = object.object_type === "header" ? "Primary menu" : "Footer menu";

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 dark:border-slate-800">
        <div className="text-sm text-slate-500">
          {saving ? "Saving…" : lastSaved ? `Saved ${lastSaved}` : "Auto-save enabled"}
          {wasLoader ? (
            <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-100">
              Title recovered from H1 (was Loader)
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Compatibility: {object.compatibility_score}%</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as ObjectStatus)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() =>
              void onSave({
                title,
                status: "approved",
                payload: buildPayload(),
                seo: { seo_title: seoTitle, meta_description: metaDescription },
                change_note: "Approved",
              })
            }
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-green-700"
          >
            Approve
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Title</label>
          <input
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-lg font-medium dark:border-slate-600 dark:bg-slate-800"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            Slug: <code>{object.slug}</code> · Type: {object.object_type} · WP: {object.wp_entity_type}
          </p>
        </section>

        {isService ? (
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/40">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Service group</h3>
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-200">
              {(object.payload.description as string) || "No description"}
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              {pageSlugs.map((slug) => (
                <li key={slug}>
                  <code>{slug}</code>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {isGlobal ? (
          <section>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{menuLabel}</label>
              <button type="button" className="text-xs text-brand-600" onClick={toggleHtmlSource}>
                {showSource ? "Menu editor" : "HTML source"}
              </button>
            </div>
            {showSource ? (
              <textarea
                className="mt-1 h-48 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs dark:border-slate-600 dark:bg-slate-900"
                value={bodyHtml}
                onChange={(e) => {
                  setBodyHtml(e.target.value);
                  setBodyText(e.target.value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
                }}
              />
            ) : (
              <MenuEditor items={menuItems} onChange={handleMenuChange} label={menuLabel} />
            )}
          </section>
        ) : (
          <section>
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Body</label>
              <button type="button" className="text-xs text-brand-600" onClick={toggleHtmlSource}>
                {showSource ? "Structured editor" : "HTML source"}
              </button>
            </div>
            {showSource ? (
              <textarea
                className="mt-1 h-80 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs dark:border-slate-600 dark:bg-slate-900"
                value={bodyHtml}
                onChange={(e) => setBodyHtml(e.target.value)}
              />
            ) : (
              <>
                <p className="mt-1 text-xs text-slate-500">
                  H2–H6 headings, paragraphs, images, and bullet/numbered lists.
                </p>
                <StructuredBodyEditor
                  bodyHtml={bodyHtml}
                  onChange={({ body_html, body_text, headings: nextHeadings }) => {
                    setBodyHtml(body_html);
                    setBodyText(body_text);
                    setHeadings(nextHeadings);
                  }}
                />
              </>
            )}
          </section>
        )}

        {!isGlobal && !isService ? (
          <section className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">SEO title</label>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Meta description
              </label>
              <textarea
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
                rows={2}
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
              />
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
