import { statSync } from "node:fs";

const MIN_SQL_DUMP_BYTES = 128;

/** Validate a WordPress / mysqldump-style SQL export before import. */
export function assertValidSqlDump(content: string, label = "SQL dump"): void {
  if (content.length < MIN_SQL_DUMP_BYTES) {
    throw new Error(`${label} is too small (${content.length} bytes).`);
  }
  const hasHeader = /(?:^|\n)-- (?:MySQL|MariaDB) dump/i.test(content);
  const hasCreate = /CREATE TABLE/i.test(content);
  const hasData = /INSERT INTO|LOCK TABLES/i.test(content);
  if (!hasCreate) {
    throw new Error(`${label} is missing CREATE TABLE statements.`);
  }
  if (!hasData) {
    throw new Error(`${label} is missing table data (INSERT INTO / LOCK TABLES).`);
  }
  if (!hasHeader && content.length < 512) {
    throw new Error(`${label} does not look like a mysqldump export.`);
  }
}

export function assertValidSqlDumpFile(filePath: string, label = "SQL dump"): void {
  const stat = statSync(filePath);
  if (!stat.isFile() || stat.size < MIN_SQL_DUMP_BYTES) {
    throw new Error(`${label} file is missing or too small: ${filePath}`);
  }
}
