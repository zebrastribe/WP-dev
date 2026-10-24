import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { assertBackupFileExists } from "../services/backup.js";

/**
 * Ensure a restore source is an existing file under
 * ~/.wp-dev/backups/<project>/<env>/.
 * Returns the resolved absolute path.
 */
export function assertRestoreBackupPath(project: string, env: string, file: string): string {
  assertBackupFileExists(file);
  const resolvedFile = resolve(file);
  const envBackupRoot = resolve(join(homedir(), ".wp-dev", "backups", project, env));
  if (!resolvedFile.startsWith(envBackupRoot + "/") && resolvedFile !== envBackupRoot) {
    throw new Error(
      `Restore refused: file must be under ~/.wp-dev/backups/${project}/${env}/`,
    );
  }
  return resolvedFile;
}
