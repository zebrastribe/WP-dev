type AdminSaveTokenFieldProps = {
  value: string;
  onChange: (value: string) => void;
  className?: string;
};

export function AdminSaveTokenField({ value, onChange, className }: AdminSaveTokenFieldProps) {
  return (
    <div
      className={
        className ??
        "rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-900/40"
      }
    >
      <label className="block font-medium text-slate-700 dark:text-slate-300">
        Admin save token{" "}
        <span className="font-normal text-slate-500 dark:text-slate-400">
          (required when WPDEV_ADMIN_SAVE_TOKEN is set in docker/.env)
        </span>
      </label>
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full max-w-md rounded border border-slate-300 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-950"
        placeholder="Paste token from docker/.env — stored in this browser"
      />
    </div>
  );
}
