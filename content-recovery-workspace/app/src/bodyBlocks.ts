export type HeadingLevel = "h2" | "h3" | "h4" | "h5" | "h6";

export type BodyBlock =
  | { id: string; type: HeadingLevel; text: string }
  | { id: string; type: "p"; text: string }
  | { id: string; type: "ul" | "ol"; items: string[] }
  | { id: string; type: "img"; src: string; alt: string };

export type HeadingsMap = {
  h1?: string;
  h2?: string[];
  h3?: string[];
  h4?: string[];
  h5?: string[];
  h6?: string[];
};

let blockId = 0;
function nextId(): string {
  blockId += 1;
  return `b${blockId}`;
}

const DIVI_CHROME =
  /et_pb_fullwidth_menu|mobile_nav|et_mobile_nav_menu|et_pb_fullwidth_header_overlay|et_pb_fullwidth_header_scroll|et_parallax_bg/;

export function normalizeMediaUrl(url: string): string {
  const m = url.match(/^https?:\/\/web\.archive\.org\/web\/\d+im_\/(https?:\/\/.+)$/i);
  return m ? m[1] : url;
}

function textOf(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function listItems(el: Element): string[] {
  return Array.from(el.querySelectorAll(":scope > li")).map((li) => textOf(li)).filter(Boolean);
}

function isDiviChrome(el: Element): boolean {
  const cls = el.getAttribute("class") ?? "";
  return DIVI_CHROME.test(cls);
}

function walk(node: Node, blocks: BodyBlock[]): void {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    if (isDiviChrome(el)) {
      return;
    }

    const tag = el.tagName.toLowerCase();

    if (tag === "h1") {
      return;
    }
    if (tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
      const t = textOf(el);
      if (t) blocks.push({ id: nextId(), type: tag, text: t });
      return;
    }
    if (tag === "p") {
      const t = textOf(el);
      if (t) blocks.push({ id: nextId(), type: "p", text: t });
      return;
    }
    if (tag === "img") {
      const src = normalizeMediaUrl(el.getAttribute("src") ?? "");
      if (src) {
        blocks.push({ id: nextId(), type: "img", src, alt: el.getAttribute("alt") ?? "" });
      }
      return;
    }
    if (tag === "ul" || tag === "ol") {
      const items = listItems(el);
      if (items.length > 0) blocks.push({ id: nextId(), type: tag, items });
      return;
    }
    if (tag === "li") {
      return;
    }

    for (const child of Array.from(el.childNodes)) {
      walk(child, blocks);
    }
    return;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const t = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (t) blocks.push({ id: nextId(), type: "p", text: t });
  }
}

export function htmlToBlocks(html: string): BodyBlock[] {
  blockId = 0;
  if (!html.trim()) return [];

  const doc = new DOMParser().parseFromString(`<div id="crw-root">${html}</div>`, "text/html");
  const root = doc.getElementById("crw-root");
  if (!root) return [];

  const blocks: BodyBlock[] = [];
  for (const child of Array.from(root.childNodes)) {
    walk(child, blocks);
  }
  return blocks;
}

export function normalizeBodyHtml(html: string): string {
  const blocks = htmlToBlocks(html);
  if (blocks.length === 0) return html.trim();
  return blocksToHtml(blocks);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

export function blocksToHtml(blocks: BodyBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "p") {
      parts.push(`<p>${escapeHtml(block.text)}</p>`);
    } else if (block.type === "ul" || block.type === "ol") {
      const items = block.items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
      parts.push(`<${block.type}>${items}</${block.type}>`);
    } else if (block.type === "img") {
      parts.push(`<img src="${escapeAttr(block.src)}" alt="${escapeAttr(block.alt)}"/>`);
    } else if (block.type === "h2" || block.type === "h3" || block.type === "h4" || block.type === "h5" || block.type === "h6") {
      parts.push(`<${block.type}>${escapeHtml(block.text)}</${block.type}>`);
    }
  }
  return parts.join("\n");
}

export function blocksToPlainText(blocks: BodyBlock[]): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === "p") {
      lines.push(block.text);
    } else if (block.type === "ul" || block.type === "ol") {
      block.items.forEach((item, i) => {
        const prefix = block.type === "ol" ? `${i + 1}. ` : "• ";
        lines.push(`${prefix}${item}`);
      });
    } else if (block.type === "img") {
      lines.push(block.alt ? `[Image: ${block.alt}]` : `[Image: ${block.src}]`);
    } else if (block.type === "h2" || block.type === "h3" || block.type === "h4" || block.type === "h5" || block.type === "h6") {
      lines.push(block.text);
    }
  }
  return lines.join("\n\n");
}

export function blocksToHeadings(blocks: BodyBlock[]): HeadingsMap {
  const headings: HeadingsMap = { h2: [], h3: [], h4: [], h5: [], h6: [] };
  for (const block of blocks) {
    if (block.type === "h2" || block.type === "h3" || block.type === "h4" || block.type === "h5" || block.type === "h6") {
      headings[block.type]?.push(block.text);
    }
  }
  return headings;
}

export function labelForBlock(type: BodyBlock["type"]): string {
  if (type === "p") return "Paragraph";
  if (type === "ul") return "Bullet list";
  if (type === "ol") return "Numbered list";
  if (type === "img") return "Image";
  return type.toUpperCase();
}
