/**
 * Best-effort table prefix from a mysqldump (first `*_options` table).
 */
export function detectTablePrefixFromSqlDump(sql: string): string | undefined {
  const m = sql.match(/CREATE TABLE(?: IF NOT EXISTS)? `([^`]+_options)`/i);
  if (!m) return undefined;
  const tableName = m[1];
  if (!tableName.endsWith("_options")) return undefined;
  return tableName.slice(0, -"options".length);
}
