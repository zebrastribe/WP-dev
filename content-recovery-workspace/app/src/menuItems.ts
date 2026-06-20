export type MenuItem = {
  label: string;
  url: string;
};

export function normalizeMenuItems(value: unknown): MenuItem[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      label: String(item.label ?? "").trim(),
      url: String(item.url ?? "").trim(),
    }))
    .filter((item) => item.label !== "" || item.url !== "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function menuItemsToHtml(items: MenuItem[], ariaLabel: string): string {
  const lines = [`<!-- ${ariaLabel} -->`, `<nav aria-label="${escapeHtml(ariaLabel)}">`, "<ul>"];
  for (const item of items) {
    if (!item.label.trim()) {
      continue;
    }
    lines.push(
      `  <li><a href="${escapeHtml(item.url)}">${escapeHtml(item.label)}</a></li>`,
    );
  }
  lines.push("</ul></nav>");
  return lines.join("\n");
}

export function menuItemsToText(items: MenuItem[]): string {
  return items
    .map((item) => item.label)
    .filter(Boolean)
    .join(" · ");
}

export function menuPayloadFromItems(
  items: MenuItem[],
  templatePart: "header" | "footer",
): { menu_items: MenuItem[]; body_html: string; body_text: string; blocks_html: string; template_part: string } {
  const ariaLabel = templatePart === "header" ? "Primary" : "Footer";
  const html = menuItemsToHtml(items, ariaLabel);
  return {
    menu_items: items,
    body_html: html,
    body_text: menuItemsToText(items),
    blocks_html: html,
    template_part: templatePart,
  };
}
