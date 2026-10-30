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
 * Reject placeholder/fabricated digests (e.g. sha256:0000…0074).
 * A real sha256 hex digest is 64 chars and must not be near-all-zero padding.
 */
export function isPlausibleImageDigestRef(ref: string): boolean {
  const m = /@sha256:([0-9a-fA-F]+)$/.exec(ref);
  if (!m) return false;
  const hex = m[1]!.toLowerCase();
  if (hex.length !== 64) return false;
  const nonzero = hex.replace(/0/g, "").length;
  // Fabricated placeholders in earlier drafts used almost-all-zero digests.
  if (nonzero < 8) return false;
  return true;
}

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
 * Falls back to tag-only reference if digest not found or looks fabricated.
 */
export function getWordPressImageWithDigest(configDir: string, phpVersion: string): string {
  const digests = loadImageDigests(configDir);
  const key = `php${phpVersion}-apache`;
  const ref = digests?.wordpress?.[key];

  if (ref && isPlausibleImageDigestRef(ref)) {
    return ref;
  }

  // Fallback to tag without digest
  return `wordpress:php${phpVersion}-apache`;
}

/**
 * Get the WP-CLI image reference with digest for a PHP version.
 * Falls back to tag-only reference if digest not found or looks fabricated.
 */
export function getWpCliImageWithDigest(configDir: string, phpVersion: string): string {
  const digests = loadImageDigests(configDir);
  const key = `cli-php${phpVersion}`;
  const ref = digests?.["wordpress-cli"]?.[key];

  if (ref && isPlausibleImageDigestRef(ref)) {
    return ref;
  }

  // Fallback to tag without digest
  return `wordpress:cli-php${phpVersion}`;
}

/**
 * PHP versions wp-dev can select (tag fallback when no verified digest is pinned).
 */
export const SUPPORTED_PHP_VERSIONS = ["7.4", "8.0", "8.1", "8.2", "8.3"];

/**
 * PHP versions with verified digests in docker/image-digests.json.
 * Prefer pinning new versions only after resolving a real registry digest.
 */
export const PINNED_PHP_VERSIONS = ["8.2"];

/**
 * Default PHP version when not specified.
 */
export const DEFAULT_PHP_VERSION = "8.2";
