import net from "node:net";
import { execa } from "execa";

export async function isPortFree(port: number, host = "0.0.0.0"): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on("error", () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

export interface PortListener {
  pid: number;
  command?: string;
}

export async function getPortListener(port: number): Promise<PortListener | null> {
  try {
    const r = await execa("ss", ["-ltnp", `sport = :${port}`], {
      reject: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = String(r.stdout ?? "");
    const m = out.match(/pid=(\d+)(?:,[^)]*)?/);
    if (m) {
      const pid = Number.parseInt(m[1], 10);
      const cmdM = out.match(/users:\(\("([^"]+)"/);
      return { pid, command: cmdM?.[1] };
    }
  } catch {
    /* ss unavailable */
  }

  try {
    const r = await execa("lsof", ["-i", `TCP:${port}`, "-sTCP:LISTEN", "-n", "-P"], {
      reject: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const line = String(r.stdout ?? "")
      .split("\n")
      .find((l) => l.includes("LISTEN"));
    if (!line) return null;
    const parts = line.trim().split(/\s+/);
    const pid = Number.parseInt(parts[1] ?? "", 10);
    const command = parts[0];
    if (Number.isFinite(pid) && pid > 0) return { pid, command };
  } catch {
    /* lsof unavailable */
  }

  return null;
}

export async function waitForPortFree(
  port: number,
  timeoutMs = 10_000,
  intervalMs = 200,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}
