import { describe, expect, it } from "vitest";
import {
  parseHostPortsFromComposePsJson,
  isPortOwnedByComposeProject,
} from "../src/utils/compose-published-ports.js";
import { parseSearchReplaceReplacementCount } from "../src/services/wpcli.js";

describe("compose-published-ports", () => {
  it("parses Publishers array from compose ps json", () => {
    const json = [
      '{"Name":"timework-wordpress-1","Publishers":[{"Protocol":"tcp","PublishedPort":8894,"TargetPort":80,"URL":"0.0.0.0"}]}',
      '{"Name":"timework-db-1","Publishers":[]}',
    ].join("\n");
    expect(parseHostPortsFromComposePsJson(json)).toEqual(new Set([8894]));
  });

  it("parses legacy Ports string from compose ps json", () => {
    const json =
      '{"Name":"wp-wordpress-1","Ports":"0.0.0.0:8890->80/tcp, :::8890->80/tcp"}';
    expect(parseHostPortsFromComposePsJson(json)).toEqual(new Set([8890]));
  });

  it("isPortOwnedByComposeProject returns true for owned ports", () => {
    const owned = new Set([8894, 7681]);
    expect(isPortOwnedByComposeProject(8894, owned)).toBe(true);
    expect(isPortOwnedByComposeProject(8895, owned)).toBe(false);
  });
});

describe("parseSearchReplaceReplacementCount", () => {
  it("reads WP-CLI replacement count", () => {
    expect(parseSearchReplaceReplacementCount("Success: Made 12 replacements.")).toBe(12);
    expect(parseSearchReplaceReplacementCount("Made 1 replacement.")).toBe(1);
    expect(parseSearchReplaceReplacementCount("nothing")).toBe(0);
  });
});
