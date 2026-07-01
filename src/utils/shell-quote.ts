/** POSIX single-quote escaping for remote shell commands (Linux/macOS SSH targets). */
export function posixShellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Quote a remote shell argument when it contains shell metacharacters. */
export function posixShellArg(value: string): string {
  if (/^[a-zA-Z0-9/._:-]+$/.test(value)) return value;
  return posixShellQuote(value);
}

export function remoteRmFile(remotePath: string): string {
  return `rm -f ${posixShellQuote(remotePath)}`;
}

export function remoteRmRf(remotePath: string): string {
  return `rm -rf ${posixShellQuote(remotePath)}`;
}
