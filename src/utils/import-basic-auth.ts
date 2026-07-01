import { execa } from "execa";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ImportBasicAuth = {
  user: string;
  password: string;
};

const HTACCESS = `RewriteEngine On
RewriteBase /import/
RewriteRule ^storage/ - [F,L]
RewriteRule ^api/ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . index.php [L]

<FilesMatch "\\.sqlite$">
  Require all denied
</FilesMatch>
`;

export function loadImportBasicAuth(configDir: string): ImportBasicAuth | null {
  const path = join(configDir, "import.auth.env");
  if (!existsSync(path)) {
    return null;
  }

  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }

  const user = values.IMPORT_BASIC_AUTH_USER ?? "";
  const password = values.IMPORT_BASIC_AUTH_PASSWORD ?? "";
  if (user === "" || password === "") {
    return null;
  }
  return { user, password };
}

/** @deprecated only used if tooling needs apr1 hashes */
export async function htpasswdLine(user: string, password: string): Promise<string> {
  const { stdout } = await execa("openssl", ["passwd", "-apr1", password], {
    encoding: "utf8",
  });
  return `${user}:${stdout.trim()}`;
}

export function writeImportRemoteConfig(
  importDir: string,
  project: string,
  auth: ImportBasicAuth | null,
): void {
  writeFileSync(join(importDir, ".htaccess"), HTACCESS);

  const htpasswd = join(importDir, ".htpasswd");
  if (existsSync(htpasswd)) {
    unlinkSync(htpasswd);
  }

  writeFileSync(join(importDir, "project.env"), `WPDEV_PROJECT=${project}\nUI_MODE=client\n`);

  if (auth) {
    writeFileSync(
      join(importDir, "api", "import.auth.env"),
      `IMPORT_BASIC_AUTH_USER=${auth.user}\nIMPORT_BASIC_AUTH_PASSWORD=${auth.password}\n`,
      { mode: 0o600 },
    );
  }
}
