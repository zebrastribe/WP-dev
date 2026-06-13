import { describe, expect, it } from "vitest";
import { siteUrlsMatchExpected } from "../src/utils/sync-verify.js";
import {
  timestampedDbName,
  timestampedFullName,
  timestampedPreRestoreName,
} from "../src/services/backup.js";

describe("siteUrlsMatchExpected", () => {
  it("matches when home and siteurl equal expected without trailing slash", () => {
    expect(
      siteUrlsMatchExpected(
        "http://localhost:8888",
        "http://localhost:8888/",
        "http://localhost:8888",
      ),
    ).toBe(true);
  });

  it("fails when siteurl differs", () => {
    expect(
      siteUrlsMatchExpected(
        "http://localhost:8888",
        "https://example.com",
        "http://localhost:8888",
      ),
    ).toBe(false);
  });
});

describe("backup timestamp names", () => {
  it("uses distinct prefixes", () => {
    expect(timestampedDbName()).toMatch(/^db-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.sql$/);
    expect(timestampedFullName()).toMatch(/^full-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.tar\.gz$/);
    expect(timestampedPreRestoreName()).toMatch(/^pre-restore-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.sql$/);
  });
});
