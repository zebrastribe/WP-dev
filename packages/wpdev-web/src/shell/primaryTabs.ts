export type PrimaryTab = "backup" | "setup" | "sync" | "advanced";

/** Primary workflow cards — same order/hints as wp-dev cloud. */
export const PRIMARY_TABS: Array<{ id: PrimaryTab; label: string; hint: string }> = [
  { id: "setup", label: "Setup", hint: "Local · Staging · Production" },
  { id: "sync", label: "Sync", hint: "Pull · push · scope" },
  { id: "backup", label: "Backup", hint: "Env · create · restore" },
];
