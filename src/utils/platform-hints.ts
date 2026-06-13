import { platform } from "node:os";

export function isMacOs(): boolean {
  return platform() === "darwin";
}

/** Shell command to open a URL in the default browser (macOS). */
export function openBrowserCommand(url: string): string | undefined {
  if (!isMacOs()) return undefined;
  const safe = url.replace(/"/g, '\\"');
  return `open "${safe}"`;
}

export function dockerStartHint(): string {
  if (isMacOs()) {
    return "Open Docker Desktop and wait until it is running, then run `wp-dev up` again.";
  }
  return "Start the Docker daemon, then run `wp-dev up` again.";
}

export function sshKeySetupHint(): string {
  if (isMacOs()) {
    return [
      "Generate a key: ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519",
      "Add to agent + Keychain: ssh-add --apple-use-keychain ~/.ssh/id_ed25519",
      "Upload ~/.ssh/id_ed25519.pub to your hosting panel.",
    ].join("\n");
  }
  return "Generate ssh-keygen -t ed25519, add the public key to your host, then test with ssh user@host.";
}

export function adminSaveTokenHint(): string {
  if (isMacOs()) {
    return "Copy WPDEV_ADMIN_SAVE_TOKEN from docker/.env (Finder: open the docker folder, or Terminal: grep WPDEV_ADMIN docker/.env).";
  }
  return "Copy WPDEV_ADMIN_SAVE_TOKEN from docker/.env into the wizard Save token field.";
}
