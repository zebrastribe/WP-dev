/** Shared toggle / outline styles for dark-mode admin UI. */

export function toggleButtonClass(active: boolean): string {
  return active
    ? "bg-brand-600 text-white"
    : "border border-slate-300 text-slate-700 dark:border-slate-600 dark:text-slate-300";
}

export const secondaryAccentButtonClass =
  "border border-brand-300 bg-brand-50 font-semibold text-brand-800 dark:border-brand-700 dark:bg-brand-950/50 dark:text-brand-200";

export const outlineButtonClass =
  "border border-slate-300 bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
