import { mkdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { assertBackupFileExists } from "../services/backup.js";

/**
 * Ensure a restore source is an existing non-empty file whose real path is under
 * ~/.wp-dev/backups/<project>/<env>/ (symlinks that escape that tree are refused).
 * Returns the real absolute path.
 */
export function assertRestoreBackupPath(project: string, env: string, file: string): string {
  assertBackupFileExists(file);

  const envBackupRootRaw = join(homedir(), ".wp-dev", "backups", project, env);
  mkdirSync(envBackupRootRaw, { recursive: true });

  let resolvedFile: string;
  let envBackupRoot: string;
  try {
    resolvedFile = realpathSync(file);
    envBackupRoot = realpathSync(envBackupRootRaw);
  } catch {
    throw new Error(`Backup file not found: ${file}`);
  }

  if (!resolvedFile.startsWith(envBackupRoot + "/") && resolvedFile !== envBackupRoot) {
    throw new Error(
      `Restore refused: file must be under ~/.wp-dev/backups/${project}/${env}/`,
    );
  }

  const st = statSync(resolvedFile);
  if (!st.isFile()) {
    throw new Error(`Restore refused: backup path is not a regular file`);
  }
  if (st.size === 0) {
    throw new Error(`Restore refused: backup file is empty`);
  }

  return resolvedFile;
}
