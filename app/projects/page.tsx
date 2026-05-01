import { FolderKanban } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ProjectCrud } from "@/components/project-crud";
import { listProjects } from "@/src/server/uiProjectData";

export default async function ProjectsPage() {
  const projects = await listProjects();

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-3 border-b border-[var(--border)] pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--primary)]">Work Helper</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-normal sm:text-3xl">Projects</h1>
          </div>
          <Badge variant="secondary">{projects.length} item</Badge>
        </header>

        {projects.length === 0 ? (
          <section className="rounded-lg border border-dashed border-[var(--border)] bg-white px-5 py-12 text-center">
            <FolderKanban className="mx-auto size-10 text-[var(--muted-foreground)]" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold">No projects registered</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--muted-foreground)]">
              Create a project to register its type, state, name, and path.
            </p>
          </section>
        ) : null}

        <ProjectCrud initialProjects={projects} />
      </div>
    </main>
  );
}
