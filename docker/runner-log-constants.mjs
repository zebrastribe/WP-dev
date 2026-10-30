/**
 * Log path constants for wp-dev runners.
 * Reads from docker/constants.json (single source of truth).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const constants = JSON.parse(readFileSync(join(__dirname, "constants.json"), "utf8"));

export const LOG_DIR_NAME = constants.log.dirName;
export const LOG_FILE_NAME = constants.log.fileName;

/**
 * Get the log file path for a workspace directory.
 * @param {string} workdir The workspace directory
 * @returns {string} Full path to the log file
 */
export function logPathForWorkdir(workdir) {
  return `${workdir}/${LOG_DIR_NAME}/${LOG_FILE_NAME}`;
}

/**
 * Get the log directory path for a workspace directory.
 * @param {string} workdir The workspace directory
 * @returns {string} Full path to the log directory
 */
export function logDirForWorkdir(workdir) {
  return `${workdir}/${LOG_DIR_NAME}`;
}
