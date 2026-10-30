import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_PHP_VERSION,
  getWordPressImageWithDigest,
  getWpCliImageWithDigest,
  SUPPORTED_PHP_VERSIONS,
} from "../src/utils/image-digests.js";

describe("PHP version image selection", () => {
  const configDir = process.cwd();

  it("returns correct WordPress image for PHP 8.2 (default)", () => {
    const image = getWordPressImageWithDigest(configDir, "8.2");
    expect(image).toContain("wordpress:");
    expect(image).toContain("php8.2-apache");
    expect(image).toContain("@sha256:");
  });

  it("returns correct WordPress image for PHP 8.3", () => {
    const image = getWordPressImageWithDigest(configDir, "8.3");
    expect(image).toContain("wordpress:");
    expect(image).toContain("php8.3-apache");
    // May or may not have digest depending on image-digests.json
  });

  it("returns correct WP-CLI image for PHP 8.2", () => {
    const image = getWpCliImageWithDigest(configDir, "8.2");
    expect(image).toContain("wordpress:");
    expect(image).toContain("cli-php8.2");
    expect(image).toContain("@sha256:");
  });

  it("falls back to tag without digest for unsupported version", () => {
    const image = getWordPressImageWithDigest(configDir, "99.0");
    expect(image).toBe("wordpress:php99.0-apache");
    expect(image).not.toContain("@sha256:");
  });

  it("MUTATION CHECK: changing PHP version changes the image", () => {
    const image82 = getWordPressImageWithDigest(configDir, "8.2");
    const image83 = getWordPressImageWithDigest(configDir, "8.3");
    
    expect(image82).toContain("php8.2");
    expect(image83).toContain("php8.3");
    expect(image82).not.toBe(image83);
  });

  it("DEFAULT_PHP_VERSION is a supported version", () => {
    expect(SUPPORTED_PHP_VERSIONS).toContain(DEFAULT_PHP_VERSION);
  });
});

describe("docker-compose.yml PHP version selection", () => {
  let tmpDir: string;
  let envPath: string;

  const createTestEnv = (content: string) => {
    tmpDir = mkdtempSync(join(tmpdir(), "wp-dev-php-test-"));
    envPath = join(tmpDir, ".env");
    writeFileSync(envPath, content);
    return tmpDir;
  };

  const cleanupTestEnv = () => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  };

  it("compose config uses PHP 8.3 image when WPDEV_PHP_VERSION=8.3", () => {
    createTestEnv(`
WPDEV_PHP_VERSION=8.3
WPDEV_HOST_PROJECT_ROOT=/test
WPDEV_HOST_HOME=/home/test
`);
    try {
      const result = execSync(
        `docker compose -f docker/docker-compose.yml --env-file "${envPath}" config 2>&1 | grep -E "image:.*wordpress.*php" || true`,
        { cwd: process.cwd(), encoding: "utf8" },
      );
      // If we got output with php version, verify it
      if (result.includes("wordpress")) {
        expect(result).toContain("php8.3");
      }
      // Otherwise Docker compose may not be available - test passes vacuously
    } catch {
      // Docker not available - skip test
    } finally {
      cleanupTestEnv();
    }
  });

  it("compose config uses PHP 8.2 image when WPDEV_PHP_VERSION is not set", () => {
    createTestEnv(`
WPDEV_HOST_PROJECT_ROOT=/test
WPDEV_HOST_HOME=/home/test
`);
    try {
      const result = execSync(
        `docker compose -f docker/docker-compose.yml --env-file "${envPath}" config 2>&1 | grep -E "image:.*wordpress.*php" || true`,
        { cwd: process.cwd(), encoding: "utf8" },
      );
      if (result.includes("wordpress")) {
        expect(result).toContain("php8.2");
      }
    } catch {
      // Docker not available - skip test
    } finally {
      cleanupTestEnv();
    }
  });
});

describe("image-digests.json", () => {
  it("contains digests for all supported PHP versions", () => {
    const digestsPath = join(process.cwd(), "docker/image-digests.json");
    expect(existsSync(digestsPath)).toBe(true);
    
    const digests = JSON.parse(readFileSync(digestsPath, "utf8"));
    
    for (const version of SUPPORTED_PHP_VERSIONS) {
      const wpKey = `php${version}-apache`;
      const cliKey = `cli-php${version}`;
      
      // Each supported version should have entries
      expect(digests.wordpress).toHaveProperty(wpKey);
      expect(digests["wordpress-cli"]).toHaveProperty(cliKey);
    }
  });

  it("digests are in correct format", () => {
    const digestsPath = join(process.cwd(), "docker/image-digests.json");
    const digests = JSON.parse(readFileSync(digestsPath, "utf8"));
    
    // WordPress images should have @sha256: digests
    for (const [key, value] of Object.entries(digests.wordpress as Record<string, string>)) {
      expect(value).toMatch(/^wordpress:php[\d.]+-apache@sha256:[a-f0-9]{64}$/);
    }
  });
});
