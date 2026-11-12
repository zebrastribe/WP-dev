/** Parse rsync --itemize-changes output into file change buckets. */

export type SyncChangeBucket = "added" | "updated" | "deleted" | "other";

export type ParsedSyncChanges = {
  added: string[];
  updated: string[];
  deleted: string[];
  other: string[];
  totalCount: number;
  truncated: boolean;
};

const MAX_PATHS = 500;

/**
 * Rsync itemize lines look like: ">f+++++++++ wp-content/themes/foo/style.css"
 * First char: > send (push), < recv (pull), * message, c local change, etc.
 */
export function parseRsyncItemizeOutput(
  output: string,
  direction: "push" | "pull",
): ParsedSyncChanges {
  const added: string[] = [];
  const updated: string[] = [];
  const deleted: string[] = [];
  const other: string[] = [];

  const transferMarker = direction === "push" ? ">" : "<";

  for (const rawLine of output.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.length < 3) continue;
    if (line.startsWith("sending incremental") || line.startsWith("sent ")) continue;
    if (line.startsWith("total size") || line.startsWith("building file list")) continue;
    if (line.startsWith(" ")) continue;

    const marker = line[0];
    if (marker !== transferMarker && marker !== "*") continue;

    if (marker === "*") {
      const deleting = /^\*deleting\s+(.+)$/.exec(line);
      const rel = (deleting?.[1] ?? "").replace(/^\.\//, "").trim();
      if (deleting && rel && rel !== "." && rel !== "./") pushBucket(deleted, rel);
      else if (!deleting) {
        const rest = line.slice(1).trim();
        if (rest) pushBucket(other, rest);
      }
      continue;
    }

    if (line.length < 12 || line[11] !== " ") continue;
    const path = line.slice(12).trim();
    if (!path || path === "./" || path === ".") continue;

    const rel = path.replace(/^\.\//, "");
    const kind = line[1] ?? "";
    const flags = line.slice(2, 11);

    if (kind === "d") {
      if (flags.includes("+")) pushBucket(added, rel);
      else pushBucket(updated, rel);
      continue;
    }

    if (flags.includes("+") && !flags.includes(".")) {
      pushBucket(added, rel);
    } else if (flags.includes("c") || flags.includes("s") || flags.includes("t")) {
      pushBucket(updated, rel);
    } else {
      pushBucket(other, rel);
    }
  }

  const totalCount = added.length + updated.length + deleted.length + other.length;
  return {
    added: cap(added),
    updated: cap(updated),
    deleted: cap(deleted),
    other: cap(other),
    totalCount,
    truncated: totalCount > MAX_PATHS,
  };
}

function pushBucket(bucket: string[], path: string): void {
  if (bucket.length >= MAX_PATHS) return;
  bucket.push(path);
}

function cap(paths: string[]): string[] {
  return paths.slice(0, MAX_PATHS);
}

export function summarizeChangePaths(changes: ParsedSyncChanges, limit = 8): string[] {
  const all = [...changes.added, ...changes.updated, ...changes.deleted];
  return all.slice(0, limit);
}

export function groupPathsByTopFolder(paths: string[]): Record<string, number> {
  const groups: Record<string, number> = {};
  for (const p of paths) {
    const top = p.split("/")[0] ?? p;
    groups[top] = (groups[top] ?? 0) + 1;
  }
  return groups;
}
