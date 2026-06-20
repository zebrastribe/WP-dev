PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source_domain TEXT,
  target_wp_url TEXT,
  created_at TEXT NOT NULL,
  config_json TEXT
);

CREATE TABLE IF NOT EXISTS content_object (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  object_type TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'recovered',
  wp_entity_type TEXT,
  wp_entity_id TEXT,
  parent_id TEXT,
  sort_order INTEGER DEFAULT 0,
  locale TEXT DEFAULT 'da',
  compatibility_score INTEGER DEFAULT 0,
  compatibility_issues_json TEXT,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,
  approved_at TEXT,
  approved_by TEXT,
  UNIQUE(project_id, object_type, slug, locale)
);

CREATE TABLE IF NOT EXISTS object_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  change_note TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT,
  source TEXT DEFAULT 'manual',
  FOREIGN KEY (object_id) REFERENCES content_object(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  value TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (object_id) REFERENCES content_object(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS media_ref (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_url TEXT,
  wayback_url TEXT,
  local_path TEXT,
  mime_type TEXT,
  alt_text TEXT,
  wp_attachment_id TEXT,
  status TEXT DEFAULT 'referenced'
);

CREATE TABLE IF NOT EXISTS object_media (
  object_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  role TEXT DEFAULT 'inline',
  PRIMARY KEY (object_id, media_id),
  FOREIGN KEY (object_id) REFERENCES content_object(id) ON DELETE CASCADE,
  FOREIGN KEY (media_id) REFERENCES media_ref(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS relationship (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  rel_type TEXT NOT NULL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS nav_menu (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  locale TEXT DEFAULT 'da'
);

CREATE TABLE IF NOT EXISTS nav_item (
  id TEXT PRIMARY KEY,
  menu_id TEXT NOT NULL,
  parent_item_id TEXT,
  object_id TEXT,
  label TEXT NOT NULL,
  url TEXT,
  sort_order INTEGER DEFAULT 0,
  FOREIGN KEY (menu_id) REFERENCES nav_menu(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS seo_meta (
  object_id TEXT PRIMARY KEY,
  seo_title TEXT,
  meta_description TEXT,
  canonical_url TEXT,
  og_title TEXT,
  og_description TEXT,
  schema_json TEXT,
  noindex INTEGER DEFAULT 0,
  FOREIGN KEY (object_id) REFERENCES content_object(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS redirect (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  from_path TEXT NOT NULL,
  to_path TEXT NOT NULL,
  status_code INTEGER DEFAULT 301,
  reason TEXT,
  source_object_id TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  action TEXT NOT NULL,
  object_id TEXT,
  actor TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_object_type_status ON content_object(project_id, object_type, status);
CREATE INDEX IF NOT EXISTS idx_object_slug ON content_object(project_id, slug);
CREATE INDEX IF NOT EXISTS idx_object_parent ON content_object(parent_id);
CREATE INDEX IF NOT EXISTS idx_version_object ON object_version(object_id, version_number);
CREATE INDEX IF NOT EXISTS idx_evidence_object ON evidence(object_id);
