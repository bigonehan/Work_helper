"use client";

import { Edit3, Plus, Save, Settings, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompactProjectPath } from "@/src/pathDisplay";
import {
  PROJECT_REGISTRY_STATES,
  PROJECT_TYPES,
  type AppSettings,
  type ProjectRegistryState,
  type UiProjectSummary,
} from "@/src/types";

interface ProjectCrudProps {
  readonly initialProjects: readonly UiProjectSummary[];
  readonly initialSettings: AppSettings;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

const projectTypePanes: readonly {
  readonly type: UiProjectSummary["type"];
  readonly title: string;
  readonly description: string;
}[] = [
  {
    type: "code",
    title: "Code",
    description: "Single codebase projects",
  },
  {
    type: "mono",
    title: "Mono",
    description: "Multi-package or monorepo projects",
  },
];

const defaultForm = { name: "", type: "code", state: "init", path: "" } satisfies ProjectForm;
const projectTypeOptions = PROJECT_TYPES.map((type) => (
  <option key={type} value={type}>
    {type}
  </option>
));
const projectStateOptions = PROJECT_REGISTRY_STATES.map((state) => (
  <option key={state} value={state}>
    {state}
  </option>
));

type ProjectForm = {
  name: string;
  type: UiProjectSummary["type"];
  state: ProjectRegistryState;
  path: string;
};

export function ProjectCrud({ initialProjects, initialSettings }: ProjectCrudProps) {
  const router = useRouter();
  const [projects, setProjects] = useState([...initialProjects]);
  const [settings, setSettings] = useState(initialSettings);
  const [settingsForm, setSettingsForm] = useState(initialSettings);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<UiProjectSummary | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState<ProjectForm>(defaultForm);
  const [editForm, setEditForm] = useState<ProjectForm>(defaultForm);
  const projectsByType = useMemo(
    () =>
      Object.fromEntries(
        PROJECT_TYPES.map((type) => [type, projects.filter((project) => project.type === type)]),
      ) as Record<UiProjectSummary["type"], UiProjectSummary[]>,
    [projects],
  );

  const reload = async () => {
    const response = await fetch("/api/projects", { cache: "no-store" });
    const data = (await response.json()) as { projects: UiProjectSummary[] };
    setProjects(data.projects);
    router.refresh();
  };

  const create = () => {
    startTransition(async () => {
      setError(null);
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) {
        setError(((await response.json()) as { error?: string }).error ?? "Create failed.");
        return;
      }
      setForm(defaultForm);
      await reload();
    });
  };

  const openSettings = () => {
    setSettingsForm(settings);
    setSettingsError(null);
    setIsSettingsOpen(true);
  };

  const saveSettings = () => {
    startTransition(async () => {
      setSettingsError(null);
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settingsForm),
      });
      if (!response.ok) {
        setSettingsError(((await response.json()) as { error?: string }).error ?? "Settings update failed.");
        return;
      }
      const data = (await response.json()) as { settings: AppSettings };
      setSettings(data.settings);
      setSettingsForm(data.settings);
      setIsSettingsOpen(false);
      router.refresh();
    });
  };

  const startEdit = (project: UiProjectSummary) => {
    setEditingId(project.id);
    setEditForm({ name: project.name, type: project.type, state: project.state, path: project.path });
  };

  const save = (projectId: string) => {
    startTransition(async () => {
      setError(null);
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!response.ok) {
        setError(((await response.json()) as { error?: string }).error ?? "Update failed.");
        return;
      }
      setEditingId(null);
      await reload();
    });
  };

  const openDelete = (project: UiProjectSummary) => {
    setDeleteTarget(project);
    setDeleteConfirmation("");
    setError(null);
  };

  const closeDelete = () => {
    setDeleteTarget(null);
    setDeleteConfirmation("");
  };

  const remove = (projectId: string, mode: "files" | "registry") => {
    startTransition(async () => {
      setError(null);
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (!response.ok) {
        setError(((await response.json()) as { error?: string }).error ?? "Delete failed.");
        return;
      }
      closeDelete();
      await reload();
    });
  };

  const renderProjectCard = (project: UiProjectSummary) => (
    <Card key={project.id} className="flex min-h-72 flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{project.name}</CardTitle>
            <CardDescription className="mt-2 line-clamp-2" title={project.path}>
              {formatCompactProjectPath(project.path)}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Badge>{project.state}</Badge>
            {project.availability === "missing" ? <Badge variant="outline">Missing</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        {editingId === project.id ? (
          <div className="grid gap-2">
            <input className={inputClass} value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} />
            <input className={inputClass} value={editForm.path} onChange={(event) => setEditForm({ ...editForm, path: event.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select className={inputClass} value={editForm.type} onChange={(event) => setEditForm({ ...editForm, type: event.target.value as ProjectForm["type"] })}>
                {projectTypeOptions}
              </select>
              <select className={inputClass} value={editForm.state} onChange={(event) => setEditForm({ ...editForm, state: event.target.value as ProjectForm["state"] })}>
                {projectStateOptions}
              </select>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-md bg-[var(--muted)] p-3">
              <p className="text-[var(--muted-foreground)]">Type</p>
              <p className="mt-1 font-medium">{project.type}</p>
            </div>
            <div className="rounded-md bg-[var(--muted)] p-3">
              <p className="text-[var(--muted-foreground)]">Drafts</p>
              <p className="mt-1 font-medium">{project.draftCount}</p>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          {project.availability === "missing" ? (
            <Button size="sm" disabled>
              Open
            </Button>
          ) : (
            <Button asChild size="sm">
              <a href={`/projects/${project.id}`}>Open</a>
            </Button>
          )}
          <div className="flex gap-2">
            {editingId === project.id ? (
              <>
                <Button size="icon" variant="outline" onClick={() => save(project.id)} aria-label="Save project">
                  <Save className="size-4" aria-hidden="true" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setEditingId(null)} aria-label="Cancel edit">
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </>
            ) : (
              <Button size="icon" variant="outline" onClick={() => startEdit(project)} aria-label="Edit project">
                <Edit3 className="size-4" aria-hidden="true" />
              </Button>
            )}
            <Button size="icon" variant="ghost" onClick={() => openDelete(project)} aria-label="Delete project">
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex justify-end">
        <Button size="icon" variant="outline" onClick={openSettings} aria-label="Open settings" title="Settings">
          <Settings className="size-4" aria-hidden="true" />
        </Button>
      </div>

      {isSettingsOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div className="w-full max-w-lg rounded-lg border border-[var(--border)] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
              <div>
                <h2 id="settings-title" className="text-lg font-semibold">
                  Settings
                </h2>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">Project creation defaults</p>
              </div>
              <Button size="icon" variant="ghost" onClick={() => setIsSettingsOpen(false)} aria-label="Close settings">
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="grid gap-4 px-5 py-5">
              <label className="grid gap-2 text-sm font-medium">
                Default project path
                <input
                  className={inputClass}
                  value={settingsForm.defaultProjectPath}
                  onChange={(event) => setSettingsForm({ ...settingsForm, defaultProjectPath: event.target.value })}
                />
              </label>
              {settingsError ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{settingsError}</p> : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-[var(--border)] px-5 py-4">
              <Button variant="outline" onClick={() => setIsSettingsOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveSettings} disabled={isPending || !settingsForm.defaultProjectPath.trim()}>
                <Save className="size-4" aria-hidden="true" />
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="delete-title">
          <div className="w-full max-w-xl rounded-lg border border-[var(--border)] bg-white shadow-xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] px-5 py-4">
              <div className="min-w-0">
                <h2 id="delete-title" className="text-lg font-semibold">
                  Delete project
                </h2>
                <p className="mt-1 truncate text-sm text-[var(--muted-foreground)]">{deleteTarget.name}</p>
              </div>
              <Button size="icon" variant="ghost" onClick={closeDelete} aria-label="Close delete dialog">
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
            <div className="grid gap-5 px-5 py-5">
              <div className="rounded-md bg-[var(--muted)] p-3 text-sm">
                <p className="font-medium">Full path</p>
                <p className="mt-1 break-all text-[var(--muted-foreground)]">{deleteTarget.path}</p>
              </div>

              <div className="grid gap-2">
                <h3 className="text-sm font-semibold">Remove from list</h3>
                <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                  Removes this project from the project page. Files stay on disk.
                </p>
                <Button variant="outline" className="w-fit" onClick={() => remove(deleteTarget.id, "registry")} disabled={isPending}>
                  Remove from list
                </Button>
              </div>

              <div className="grid gap-3 border-t border-[var(--border)] pt-5">
                <h3 className="text-sm font-semibold text-red-700">Delete project files</h3>
                {deleteTarget.availability === "missing" ? (
                  <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                    The project folder is missing, so only the registry entry can be removed.
                  </p>
                ) : (
                  <>
                    <p className="text-sm leading-6 text-[var(--muted-foreground)]">
                      Deletes the project folder from disk and removes this project from the list.
                    </p>
                    <label className="grid gap-2 text-sm font-medium">
                      Type the project name to confirm
                      <input
                        className={inputClass}
                        value={deleteConfirmation}
                        onChange={(event) => setDeleteConfirmation(event.target.value)}
                      />
                    </label>
                    <Button
                      variant="outline"
                      className="w-fit border-red-200 text-red-700 hover:bg-red-50"
                      onClick={() => remove(deleteTarget.id, "files")}
                      disabled={isPending || deleteConfirmation !== deleteTarget.name}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      Delete project files
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Create project</CardTitle>
          <CardDescription>Project list data is stored in this app; project details live in each project folder.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[1fr_9rem_9rem_1.4fr_auto]">
          <input className={inputClass} placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <select className={inputClass} value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as ProjectForm["type"] })}>
            {projectTypeOptions}
          </select>
          <select className={inputClass} value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value as ProjectForm["state"] })}>
            {projectStateOptions}
          </select>
          <input
            className={inputClass}
            placeholder={`Default: ${settings.defaultProjectPath}/project-id`}
            value={form.path}
            onChange={(event) => setForm({ ...form, path: event.target.value })}
          />
          <Button onClick={create} disabled={isPending || !form.name.trim()}>
            <Plus className="size-4" aria-hidden="true" />
            Create
          </Button>
        </CardContent>
      </Card>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <section className="grid gap-5">
        {projectTypePanes.map((pane) => {
          const paneProjects = projectsByType[pane.type];

          return (
            <div key={pane.type} className="rounded-lg border border-[var(--border)] bg-white p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{pane.title}</h2>
                  <p className="mt-1 text-sm text-[var(--muted-foreground)]">{pane.description}</p>
                </div>
                <Badge variant="secondary">{paneProjects.length} item</Badge>
              </div>

              {paneProjects.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{paneProjects.map(renderProjectCard)}</div>
              ) : (
                <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--muted)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  No {pane.type} projects.
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}
