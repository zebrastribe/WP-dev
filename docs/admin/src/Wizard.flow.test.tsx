import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Wizard } from "./Wizard";

vi.mock("./AdminAuthProvider", () => ({
  useAdminAuth: () => ({
    authenticated: true,
    authVersion: 1,
    requestUnlock: vi.fn(),
  }),
}));

vi.mock("./useRunnerSecrets", () => ({
  useRunnerSecrets: () => ({
    terminalAuth: "",
    runnerMessage: "Ready",
    canRun: true,
  }),
}));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    loadWpDevConfigDetailed: vi.fn(async () => ({ status: "missing" as const })),
    loadLocalStatus: vi.fn(async () => ({ ok: false as const, error: "offline" })),
    loadStagingDbSecrets: vi.fn(async () => ({ ok: false as const, error: "none" })),
    loadSimplyStatus: vi.fn(async () => ({ ok: false as const, error: "none" })),
  };
});

describe("Wizard step flow", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("skips Live SSH and Staging for a new local site", async () => {
    const user = userEvent.setup();
    render(<Wizard />);

    await screen.findByRole("radio", { name: /New local WordPress site only/i });
    await user.click(screen.getByRole("radio", { name: /New local WordPress site only/i }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Live SSH" })).toBeNull();
    });
    expect(screen.queryByRole("button", { name: "Staging" })).toBeNull();
    expect(screen.getByText(/then First backup/i)).toBeTruthy();
    expect(screen.getByText(/DNS provider \(Simply\.com\) — optional/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next →" }));

    expect(await screen.findByRole("heading", { name: "First backup" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Live SSH" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "← Previous" }));
    expect(screen.getByRole("radio", { name: /New local WordPress site only/i })).toBeTruthy();
  });

  it("keeps staging writes separate from the read-only check", async () => {
    const user = userEvent.setup();
    render(<Wizard />);

    await user.click(await screen.findByRole("radio", { name: /Sync from my server/i }));
    await screen.findByRole("button", { name: "Live SSH" });
    await user.click(screen.getAllByRole("button", { name: "Next →" }).at(-1)!);
    expect(await screen.findByText(/Advanced → Terminal/i)).toBeTruthy();
    expect(screen.queryByText("Browser terminal (optional)")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Staging" }));
    await user.click(screen.getByRole("checkbox", { name: /I have a real staging server/i }));

    expect(screen.getByRole("button", { name: "Run staging check" })).toBeTruthy();
    expect(screen.getByText("Individual checks")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply HTTP auth on staging" })).toBeTruthy();
    expect(screen.getByText(/Required for push staging: staging\.db settings/i)).toBeTruthy();
    expect(screen.queryByText("Browser terminal (optional)")).toBeNull();
  });
});
