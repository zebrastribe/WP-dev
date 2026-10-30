/**
 * Connection-drop retries for host-side rsync (shared hosting / slow links).
 * Rsync is incremental + --partial, so a re-run resumes instead of starting over.
 */

export type RsyncAttemptResult = {
  exitCode: number | null;
  stderr: string;
  stdout?: string;
};

/** rsync: 10 socket I/O, 12 protocol, 30 timeout; OpenSSH often exits 255. */
const TRANSIENT_EXIT_CODES = new Set([10, 12, 30, 255]);

const TRANSIENT_STDERR =
  /Connection reset|Broken pipe|Connection timed out|Connection closed|Network is unreachable|No route to host|Connection refused|Write failed|Read from remote host|ssh_exchange_identification|kex_exchange_identification|Temporary failure|Resource temporarily unavailable|Timeout in data send\/receive|Connection to .+ closed|Lost connection|rsync: connection unexpectedly closed|error in rsync protocol data stream/i;

const NON_TRANSIENT_STDERR =
  /Permission denied|mkstemp|Operation not permitted|No such file or directory|change_dir .* failed|Disk quota exceeded|No space left on device/i;

export function isTransientRsyncFailure(
  exitCode: number | null,
  stderr: string,
): boolean {
  if (exitCode === 0) return false;
  // Hard local/remote FS errors must not spin retries (except when stderr is only a drop).
  if (NON_TRANSIENT_STDERR.test(stderr) && !TRANSIENT_STDERR.test(stderr)) {
    return false;
  }
  if (exitCode != null && TRANSIENT_EXIT_CODES.has(exitCode)) return true;
  return TRANSIENT_STDERR.test(stderr);
}

/** Exponential backoff: base * 2^(attempt-1), capped at 30s. attempt is 1-based for the next wait. */
export function rsyncConnectionRetryDelayMs(attempt: number, baseDelayMs = 2_000): number {
  const exp = Math.max(0, attempt - 1);
  return Math.min(30_000, baseDelayMs * 2 ** exp);
}

export type RsyncConnectionRetryOptions = {
  /** Live transfers: 5. Dry-run defaults lower via caller. */
  maxAttempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: {
    attempt: number;
    maxAttempts: number;
    exitCode: number | null;
    stderr: string;
    delayMs: number;
  }) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Re-run `runOnce` while the failure looks like a dropped SSH/rsync connection.
 * Caller should use incremental rsync flags (--partial) so retries resume.
 */
export async function runRsyncWithConnectionRetries(
  runOnce: () => Promise<RsyncAttemptResult>,
  options: RsyncConnectionRetryOptions = {},
): Promise<RsyncAttemptResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 5);
  const baseDelayMs = options.baseDelayMs ?? 2_000;
  const sleep = options.sleep ?? defaultSleep;

  let last: RsyncAttemptResult = { exitCode: 1, stderr: "" };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await runOnce();
    if (last.exitCode === 0) return last;
    if (!isTransientRsyncFailure(last.exitCode, last.stderr)) return last;
    if (attempt >= maxAttempts) return last;

    const delayMs = rsyncConnectionRetryDelayMs(attempt, baseDelayMs);
    options.onRetry?.({
      attempt,
      maxAttempts,
      exitCode: last.exitCode,
      stderr: last.stderr,
      delayMs,
    });
    await sleep(delayMs);
  }
  return last;
}
