import { loadRepoSnapshot, parseRepositoryUrl } from "@wpdev/sync-engine";

/** Print the branches the repository currently has. Nothing here is a fixed branch name. */
export async function cmdRepoBranches(url: string): Promise<void> {
  const ref = parseRepositoryUrl(url);
  const token = process.env.WPDEV_GIT_TOKEN?.trim() || undefined;
  const snapshot = await loadRepoSnapshot(ref, token, fetch);
  console.log(
    JSON.stringify({
      provider: ref.provider,
      owner: ref.owner,
      name: ref.name,
      truncated: snapshot.truncated,
      branches: snapshot.branches.map((row) => ({
        name: row.name,
        sha: row.sha.slice(0, 7),
      })),
    }),
  );
}
