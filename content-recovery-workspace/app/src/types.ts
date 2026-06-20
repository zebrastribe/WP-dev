export type ObjectType =
  | "page"
  | "post"
  | "job"
  | "service"
  | "header"
  | "footer"
  | "navigation";

export type ObjectStatus =
  | "recovered"
  | "needs_review"
  | "edited"
  | "reviewed"
  | "approved"
  | "ready_for_export"
  | "exported"
  | "excluded";

export type ContentListItem = {
  id: string;
  object_type: string;
  slug: string;
  title: string;
  status: ObjectStatus;
  locale: string;
  compatibility_score: number;
  updated_at: string;
  excerpt: string;
};

export type SeoMeta = {
  seo_title?: string | null;
  meta_description?: string | null;
  canonical_url?: string | null;
  og_title?: string | null;
  og_description?: string | null;
};

export type Evidence = {
  id: string;
  evidence_type: string;
  value: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

export type ObjectVersion = {
  version_number: number;
  change_note?: string | null;
  created_at: string;
  created_by?: string | null;
  source: string;
};

export type ContentObject = {
  id: string;
  object_type: string;
  slug: string;
  title: string;
  status: ObjectStatus;
  wp_entity_type?: string | null;
  locale: string;
  compatibility_score: number;
  compatibility_issues: string[];
  payload: {
    body_html?: string;
    body_text?: string;
    h1?: string;
    exclude_from_import?: boolean;
    original_url?: string;
    page_slugs?: string[];
    [key: string]: unknown;
  };
  seo?: SeoMeta | null;
  evidence: Evidence[];
  versions: ObjectVersion[];
  created_at: string;
  updated_at: string;
  approved_at?: string | null;
  approved_by?: string | null;
};

export type ProjectStats = {
  ok: boolean;
  project: string;
  counts: Record<string, { total: number; by_status: Record<string, number> }>;
};
