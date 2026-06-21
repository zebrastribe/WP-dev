import { describe, expect, it, vi } from "vitest";
import { confirmProduction, confirmRemoteTarget } from "../src/utils/confirm.js";

const questionMock = vi.fn();
const closeMock = vi.fn();

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({
    question: questionMock,
    close: closeMock,
  }),
}));

describe("confirm", () => {
  it("confirmProduction accepts yes", async () => {
    questionMock.mockResolvedValueOnce("yes");
    await expect(confirmProduction("Danger:")).resolves.toBe(true);
  });

  it("confirmProduction rejects other answers", async () => {
    questionMock.mockResolvedValueOnce("no");
    await expect(confirmProduction("Danger:")).resolves.toBe(false);
  });

  it("confirmRemoteTarget requires exact staging host", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    questionMock.mockResolvedValueOnce("staging.host");
    await expect(
      confirmRemoteTarget("staging", { host: "staging.host", url: "https://s.example" }, "push"),
    ).resolves.toBe(true);
  });

  it("confirmRemoteTarget rejects wrong staging host", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    questionMock.mockResolvedValueOnce("wrong.host");
    await expect(
      confirmRemoteTarget("staging", { host: "staging.host", url: "https://s.example" }, "push"),
    ).resolves.toBe(false);
  });

  it("confirmRemoteTarget auto-approves staging without a TTY", async () => {
    const isTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await expect(
      confirmRemoteTarget("staging", { host: "staging.host", url: "https://s.example" }, "push"),
    ).resolves.toBe(true);
    Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
  });

  it("confirmRemoteTarget rejects production without a TTY", async () => {
    const isTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    await expect(
      confirmRemoteTarget(
        "production",
        { host: "prod.host", url: "https://prod.example" },
        "push",
      ),
    ).resolves.toBe(false);
    Object.defineProperty(process.stdin, "isTTY", { value: isTTY, configurable: true });
  });
});
