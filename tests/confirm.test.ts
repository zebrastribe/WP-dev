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
    questionMock.mockResolvedValueOnce("staging.host");
    await expect(
      confirmRemoteTarget("staging", { host: "staging.host", url: "https://s.example" }, "push"),
    ).resolves.toBe(true);
  });

  it("confirmRemoteTarget rejects wrong staging host", async () => {
    questionMock.mockResolvedValueOnce("wrong.host");
    await expect(
      confirmRemoteTarget("staging", { host: "staging.host", url: "https://s.example" }, "push"),
    ).resolves.toBe(false);
  });

  it("confirmRemoteTarget uses yes for production", async () => {
    questionMock.mockResolvedValueOnce("yes");
    await expect(
      confirmRemoteTarget(
        "production",
        { host: "prod.host", url: "https://prod.example" },
        "restore",
      ),
    ).resolves.toBe(true);
  });
});
