"use client";

import { Edit3, Plus, Save, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { UiProjectSummary } from "@/src/server/uiProjectData";

interface ProjectCrudProps {
  readonly initialProjects: readonly UiProjectSummary[];
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

export function ProjectCrud({ initialProjects }: ProjectCrudProps) {
  const router = useRouter();
  const [projects, setProjects] = useState([...initialProjects]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({ name: "", type: "code", state: "init", path: "" });
  const [editForm, setEditForm] = useState({ name: "", type: "code", state: "init", path: "" });

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
      setForm({ name: "", type: "code", state: "init", path: "" });
      await reload();
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

  const remove = (projectId: string) => {
    startTransition(async () => {
      setError(null);
      const response = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!response.ok) {
        setError(((await response.json()) as { error?: string }).error ?? "Delete failed.");
        return;
      }
      await reload();
    });
  };

  const renderProjectCard = (project: UiProjectSummary) => (
    <Card key={project.id} className="flex min-h-72 flex-col">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate">{project.name}</CardTitle>
            <CardDescription className="mt-2 line-clamp-2">{project.path}</CardDescription>
          </div>
          <Badge>{project.state}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-between gap-4">
        {editingId === project.id ? (
          <div className="grid gap-2">
            <input className={inputClass} value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} />
            <input className={inputClass} value={editForm.path} onChange={(event) => setEditForm({ ...editForm, path: event.target.value })} />
            <div className="grid grid-cols-2 gap-2">
              <select className={inputClass} value={editForm.type} onChange={(event) => setEditForm({ ...editForm, type: event.target.value })}>
                <option value="code">code</option>
                <option value="mono">mono</option>
              </select>
              <select className={inputClass} value={editForm.state} onChange={(event) => setEditForm({ ...editForm, state: event.target.value })}>
                <option value="init">init</option>
                <option value="wait">wait</option>
                <option value="work">work</option>
                <option value="check">check</option>
                <option value="complete">complete</option>
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
          <Button asChild size="sm">
            <a href={`/projects/${project.id}`}>Open</a>
          </Button>
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
            <Button size="icon" variant="ghost" onClick={() => remove(project.id)} aria-label="Delete project">
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Create project</CardTitle>
          <CardDescription>Project list data is stored in this app; project details live in each project folder.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[1fr_9rem_9rem_1.4fr_auto]">
          <input className={inputClass} placeholder="Name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <select className={inputClass} value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
            <option value="code">code</option>
            <option value="mono">mono</option>
          </select>
          <select className={inputClass} value={form.state} onChange={(event) => setForm({ ...form, state: event.target.value })}>
            <option value="init">init</option>
            <option value="wait">wait</option>
            <option value="work">work</option>
            <option value="check">check</option>
            <option value="complete">complete</option>
          </select>
          <input className={inputClass} placeholder="Path (optional)" value={form.path} onChange={(event) => setForm({ ...form, path: event.target.value })} />
          <Button onClick={create} disabled={isPending || !form.name.trim()}>
            <Plus className="size-4" aria-hidden="true" />
            Create
          </Button>
        </CardContent>
      </Card>

      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <section className="grid gap-5 xl:grid-cols-2">
        {projectTypePanes.map((pane) => {
          const paneProjects = projects.filter((project) => project.type === pane.type);

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
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">{paneProjects.map(renderProjectCard)}</div>
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
