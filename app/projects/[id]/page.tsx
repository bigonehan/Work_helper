import { ArrowLeft, CheckCircle2, FileText } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RequestRunner } from "@/components/request-runner";
import { getProjectDetail, listProjects } from "@/src/server/uiProjectData";

export const generateStaticParams = async () => {
  const projects = await listProjects();
  return projects.map((project) => ({ id: project.id }));
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getProjectDetail(id);
  if (!detail) {
    notFound();
  }

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="flex flex-col gap-4 border-b border-[var(--border)] pb-5">
          <Button asChild variant="ghost" size="sm" className="w-fit">
            <Link href="/projects">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Projects
            </Link>
          </Button>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-[var(--primary)]">Project detail</p>
              <h1 className="mt-1 truncate text-2xl font-semibold tracking-normal sm:text-3xl">
                {detail.project.name}
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted-foreground)]">
                {detail.project.description}
              </p>
            </div>
            <Badge>{detail.project.state}</Badge>
          </div>
        </header>

        <RequestRunner projectId={id} initialJobDocument={detail.jobDocument} />

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <Card>
            <CardHeader>
              <CardTitle>Job</CardTitle>
              <CardDescription>Current workflow requirement and checklists</CardDescription>
            </CardHeader>
            <CardContent>
              {detail.jobDocument ? (
                <pre className="max-h-[28rem] rounded-md bg-[var(--muted)] p-4 text-sm leading-6">
                  {detail.jobDocument}
                </pre>
              ) : (
                <p className="text-sm text-[var(--muted-foreground)]">No job document found.</p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Type</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-[var(--muted-foreground)]">{detail.project.type}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Spec</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-[var(--muted-foreground)]">{detail.project.spec}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Drafts</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-[var(--muted-foreground)]">{detail.drafts.length}</CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          {detail.drafts.map((draft) => (
            <Card key={draft.path}>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{draft.summary}</CardTitle>
                    <CardDescription>{draft.itemCount} draft items</CardDescription>
                  </div>
                  <FileText className="size-5 text-[var(--muted-foreground)]" aria-hidden="true" />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <CheckCircle2 className="size-4 text-[var(--primary)]" aria-hidden="true" />
                    Automated checks
                  </h2>
                  <ul className="mt-2 space-y-2 text-sm text-[var(--muted-foreground)]">
                    {draft.automatedChecks.map((check) => (
                      <li key={check} className="rounded-md bg-[var(--muted)] px-3 py-2">
                        {check}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Assertions</h2>
                  <ul className="mt-2 space-y-2 text-sm text-[var(--muted-foreground)]">
                    {draft.assertions.map((assertion) => (
                      <li key={assertion} className="rounded-md bg-[var(--muted)] px-3 py-2">
                        {assertion}
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      </div>
    </main>
  );
}
