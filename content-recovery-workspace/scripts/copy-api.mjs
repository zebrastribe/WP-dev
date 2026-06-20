import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "..", "wordpress", "import");

mkdirSync(join(out, "api"), { recursive: true });
mkdirSync(join(out, "storage"), { recursive: true });
cpSync(join(root, "api"), join(out, "api"), { recursive: true });
writeFileSync(join(out, "index.php"), readFileSync(join(root, "index.php")));

writeFileSync(
  join(out, "storage", ".htaccess"),
  `Require all denied
`,
);

writeFileSync(
  join(out, ".htaccess"),
  `RewriteEngine On
RewriteBase /import/
RewriteRule ^storage/ - [F,L]
RewriteRule ^api/ - [L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . index.php [L]

<FilesMatch "\\.sqlite$">
  Require all denied
</FilesMatch>
`,
);

console.log("Copied API to wordpress/import/api/");
