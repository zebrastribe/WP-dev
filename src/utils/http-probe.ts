export type HttpProbe = {
  ok: boolean;
  status: number;
  finalUrl: string;
  hops: string[];
  error?: string;
};

/** Follow redirects manually (up to 6 hops) and return the final response. */
export async function probeHttpUrl(url: string): Promise<HttpProbe> {
  const hops: string[] = [];
  let current = url;
  for (let i = 0; i < 6; i++) {
    let res: Response;
    try {
      res = await fetch(current, { method: "GET", redirect: "manual" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        status: 0,
        finalUrl: current,
        hops,
        error: msg,
      };
    }
    const status = res.status;
    const loc = res.headers.get("location");
    if (loc && status >= 300 && status < 400) {
      const next = new URL(loc, current).toString();
      hops.push(`${status} -> ${next}`);
      current = next;
      continue;
    }
    hops.push(`${status} @ ${current}`);
    return {
      ok: status >= 200 && status < 400,
      status,
      finalUrl: current,
      hops,
    };
  }
  return {
    ok: false,
    status: 0,
    finalUrl: current,
    hops,
    error: "too_many_redirects",
  };
}
