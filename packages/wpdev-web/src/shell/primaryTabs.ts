export type PrimaryTab = "backup" | "setup" | "sync" | "advanced";

export const PRIMARY_TABS: { id: PrimaryTab; label: string }[] = [
  { id: "backup", label: "Backup" },
  { id: "setup", label: "Setup staging" },
  { id: "sync", label: "Sync" },
  { id: "advanced", label: "Advanced" },
];
