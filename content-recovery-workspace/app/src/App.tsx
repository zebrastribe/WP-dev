import { useCallback, useEffect, useState } from "react";
import {
  exportProject,
  fetchObject,
  fetchObjects,
  fetchStats,
  ingestKnowledgeBase,
  patchObject,
  validateProject,
} from "./api";
import { AuthGate } from "./components/AuthGate";
import { Editor } from "./components/Editor";
import { EvidencePanel } from "./components/EvidencePanel";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import type { ContentListItem, ContentObject, ProjectStats } from "./types";

export default function App() {
  const [ready, setReady] = useState(false);
  const [project, setProject] = useState("—");
  const [stats, setStats] = useState<ProjectStats>();
  const [activeType, setActiveType] = useState("page");
  const [objects, setObjects] = useState<ContentListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [selected, setSelected] = useState<ContentObject | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string>();
  const [message, setMessage] = useState("");
  const [clientMode, setClientMode] = useState(false);

  const refreshStats = useCallback(async () => {
    const s = await fetchStats();
    setStats(s);
    setProject(s.project);
  }, []);

  const refreshList = useCallback(async () => {
    const res = await fetchObjects({
      type: activeType,
      search: search.trim() || undefined,
    });
    setObjects(res.objects);
  }, [activeType, search]);

  const loadObject = useCallback(async (id: string) => {
    const res = await fetchObject(id);
    setSelected(res.object);
    setSelectedId(id);
  }, []);

  useEffect(() => {
    if (!ready) return;
    void refreshStats();
    void refreshList();
  }, [ready, refreshStats, refreshList]);

  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => void refreshList(), 300);
    return () => window.clearTimeout(t);
  }, [search, ready, refreshList]);

  useEffect(() => {
    if (!ready) return;
    void refreshList();
    setSelected(null);
    setSelectedId(undefined);
  }, [activeType, ready, refreshList]);

  const handleSave = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!selectedId) return;
      setSaving(true);
      try {
        const res = await patchObject(selectedId, patch);
        setSelected(res.object);
        setLastSaved(new Date().toLocaleTimeString());
        await refreshList();
        await refreshStats();
      } finally {
        setSaving(false);
      }
    },
    [selectedId, refreshList, refreshStats],
  );

  async function handleIngest() {
    setBusy(true);
    setMessage("");
    try {
      const res = await ingestKnowledgeBase();
      setMessage(`Ingested: ${JSON.stringify(res.stats)}`);
      await refreshStats();
      await refreshList();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Ingest failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleValidate() {
    setBusy(true);
    setMessage("");
    try {
      const res = await validateProject();
      const r = res.report;
      setMessage(
        r.ok
          ? `Validation passed (${r.object_count} objects, avg ${r.compatibility_avg}%)`
          : `Validation failed: ${r.errors.length} errors, ${r.warnings.length} warnings`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleExport() {
    setBusy(true);
    setMessage("");
    try {
      const res = await exportProject("all");
      if (res.export) {
        setMessage(`Exported to ${res.export.directory}: ${res.export.files.join(", ")}`);
      }
      await refreshStats();
      await refreshList();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Export failed";
      setMessage(
        clientMode
          ? `Export blocked — fix these first: ${msg}`
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthGate
      onReady={(mode) => {
        setClientMode(mode);
        setReady(true);
      }}
    >
      <div className="flex h-screen flex-col">
        <TopBar
          project={project}
          stats={stats}
          search={search}
          onSearchChange={setSearch}
          onValidate={() => void handleValidate()}
          onExport={() => void handleExport()}
          onIngest={() => void handleIngest()}
          busy={busy}
          clientMode={clientMode}
        />
        {message ? (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            {message}
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1">
          <Sidebar
            activeType={activeType}
            onTypeChange={setActiveType}
            objects={objects}
            selectedId={selectedId}
            onSelect={(id) => void loadObject(id)}
            stats={stats}
          />
          <Editor object={selected} onSave={handleSave} saving={saving} lastSaved={lastSaved} />
          <EvidencePanel object={selected} />
        </div>
      </div>
    </AuthGate>
  );
}
