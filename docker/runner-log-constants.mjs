/**
 * Log path constants for wp-dev runners.
 * Single source of truth - must match src/utils/logger.ts.
 *
 * DO NOT EDIT: These values are defined here and in src/utils/logger.ts.
 * If you change these, update both files and run tests.
 */

export const LOG_DIR_NAME = "logs";
export const LOG_FILE_NAME = "wp-dev.log";

/**
 * Get the log file path for a workspace directory.
 * @param {string} workdir The workspace directory
 * @returns {string} Full path to the log file
 */
export function logPathForWorkdir(workdir) {
  // Using path.join equivalent
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
