/**
 * Image digest lookups for reproducible Docker builds.
 *
 * Single source of truth: docker/image-digests.json
 * This module provides type-safe access to image references with digests.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface ImageDigests {
  wordpress: Record<string, string>;
  "wordpress-cli": Record<string, string>;
  mysql: Record<string, string>;
  nginx: Record<string, string>;
  node: Record<string, string>;
}

let cachedDigests: ImageDigests | null = null;

/**
 * Load image digests from docker/image-digests.json.
 * Caches the result for subsequent calls.
 */
export function loadImageDigests(configDir: string): ImageDigests | null {
  if (cachedDigests) return cachedDigests;

  const digestPath = join(configDir, "docker", "image-digests.json");
  if (!existsSync(digestPath)) {
    return null;
  }

  try {
    const content = readFileSync(digestPath, "utf8");
    cachedDigests = JSON.parse(content) as ImageDigests;
    return cachedDigests;
  } catch {
    return null;
  }
}

/**
 * Get the WordPress image reference with digest for a PHP version.
 * Falls back to tag-only reference if digest not found.
 */
export function getWordPressImageWithDigest(configDir: string, phpVersion: string): string {
  const digests = loadImageDigests(configDir);
  const key = `php${phpVersion}-apache`;

  if (digests?.wordpress?.[key]) {
    return digests.wordpress[key];
  }

  // Fallback to tag without digest
  return `wordpress:php${phpVersion}-apache`;
}

/**
 * Get the WP-CLI image reference with digest for a PHP version.
 * Falls back to tag-only reference if digest not found.
 */
export function getWpCliImageWithDigest(configDir: string, phpVersion: string): string {
  const digests = loadImageDigests(configDir);
  const key = `cli-php${phpVersion}`;

  if (digests?.["wordpress-cli"]?.[key]) {
    return digests["wordpress-cli"][key];
  }

  // Fallback to tag without digest
  return `wordpress:cli-php${phpVersion}`;
}

/**
 * Supported PHP versions (those with digests in image-digests.json).
 */
export const SUPPORTED_PHP_VERSIONS = ["7.4", "8.0", "8.1", "8.2", "8.3"];

/**
 * Default PHP version when not specified.
 */
export const DEFAULT_PHP_VERSION = "8.2";
