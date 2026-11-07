export type PrimaryTab = "backup" | "setup" | "sync" | "update" | "advanced";

/** Primary workflow cards. Update is on both WP-dev Local and WP-dev Cloud. */
export const PRIMARY_TABS: Array<{ id: PrimaryTab; label: string; hint: string }> = [
  { id: "setup", label: "Setup", hint: "Local · Staging · Production" },
  { id: "sync", label: "Sync", hint: "Pull · push · scope" },
  { id: "backup", label: "Backup", hint: "Env · create · restore" },
  { id: "update", label: "Update", hint: "This site · WordPress" },
];
