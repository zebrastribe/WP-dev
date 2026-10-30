import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BackupRestore } from "./BackupRestore";

const runTerminalActionMock = vi.fn();
const getTerminalJobStatusMock = vi.fn();
const loadWpDevConfigMock = vi.fn();

vi.mock("./api", () => ({
  runTerminalAction: (...args: unknown[]) => runTerminalActionMock(...args),
  getTerminalJobStatus: (...args: unknown[]) => getTerminalJobStatusMock(...args),
  loadWpDevConfig: () => loadWpDevConfigMock(),
}));

vi.mock("./useRunnerSecrets", () => ({
  useRunnerSecrets: () => ({
    runnerReady: true,
    runnerMessage: "Ready",
    canRun: true,
  }),
}));

describe("BackupRestore restore validation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    runTerminalActionMock.mockReset();
    getTerminalJobStatusMock.mockReset();
    loadWpDevConfigMock.mockResolvedValue({ staging: { host: "staging.example.com" } });
    runTerminalActionMock.mockResolvedValue({ ok: true, jobId: "job-1" });
    getTerminalJobStatusMock.mockResolvedValue({
      ok: true,
      status: "done",
      exitCode: 0,
      output: "VALID: /path/to/backup.sql",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("validates path when typed", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<BackupRestore />);

    const inputs = screen.getAllByPlaceholderText(/\.wp-dev\/backups/i);
    const input = inputs[0];
    await user.type(input, "/home/user/.wp-dev/backups/test/local/db-backup.sql");

    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => {
      expect(runTerminalActionMock).toHaveBeenCalledWith(
        "validate_restore_path",
        expect.objectContaining({ env: "local" }),
      );
    });
  });

  it("validates different paths separately", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { unmount } = render(<BackupRestore />);

    const inputs = screen.getAllByPlaceholderText(/\.wp-dev\/backups/i);
    const input = inputs[0];
    await user.type(input, "/path/one.sql");

    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => {
      expect(runTerminalActionMock).toHaveBeenCalledTimes(1);
    });

    unmount();
    runTerminalActionMock.mockClear();

    render(<BackupRestore />);
    const newInputs = screen.getAllByPlaceholderText(/\.wp-dev\/backups/i);
    const newInput = newInputs[0];
    await user.type(newInput, "/path/two.sql");

    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => {
      expect(runTerminalActionMock).toHaveBeenCalledTimes(1);
    });
  });

  it("validates again when env changes", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<BackupRestore />);

    const inputs = screen.getAllByPlaceholderText(/\.wp-dev\/backups/i);
    const input = inputs[0];
    await user.type(input, "/path/backup.sql");

    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => {
      expect(runTerminalActionMock).toHaveBeenCalledTimes(1);
    });

    const stagingButtons = screen.getAllByRole("button", { name: /staging/i });
    await user.click(stagingButtons[0]);

    await vi.advanceTimersByTimeAsync(600);
    await waitFor(() => {
      expect(runTerminalActionMock).toHaveBeenCalledTimes(2);
    });
  });
});
