/** Redact secrets that may appear in WP-CLI or shell error output. */
export function sanitizeCliError(text: string): string {
  return text
    .replace(/--dbpass=(?:'[^']*'|\S+)/gi, "--dbpass=[redacted]")
    .replace(/--dbuser=(?:'[^']*'|\S+)/gi, "--dbuser=[redacted]")
    .replace(/--dbname=(?:'[^']*'|\S+)/gi, "--dbname=[redacted]")
    .replace(/(-p|--password=)(?:'[^']*'|\S+)/gi, "$1[redacted]");
}
