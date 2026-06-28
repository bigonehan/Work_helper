"use client";

import { CheckCircle2, ClipboardList, FileText, History, ListChecks } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import type { UiDraftSummary } from "@/src/types";

type DetailTab = "job" | "planning" | "drafts";

interface ProjectDetailTabsProps {
  readonly jobDocument: string | null;
  readonly planningDocument: string | null;
  readonly drafts: readonly UiDraftSummary[];
}

const tabItems: readonly {
  readonly id: DetailTab;
  readonly label: string;
  readonly description: string;
  readonly icon: typeof FileText;
}[] = [
  {
    id: "job",
    label: "Job",
    description: "Current workflow requirement and checklists",
    icon: ClipboardList,
  },
  {
    id: "planning",
    label: "기획",
    description: "project.md planning section",
    icon: FileText,
  },
  {
    id: "drafts",
    label: "Drafts",
    description: "Draft bundle history and checks",
    icon: History,
  },
];

export const ProjectDetailTabs = ({ jobDocument, planningDocument, drafts }: ProjectDetailTabsProps) => {
  const [activeTab, setActiveTab] = useState<DetailTab>("job");
  const [selectedDraftPath, setSelectedDraftPath] = useState<string | null>(drafts[0]?.path ?? null);
  const baseId = useId();
  const activeItem = tabItems.find((item) => item.id === activeTab) ?? tabItems[0];
  const ActiveIcon = activeItem.icon;
  const activeDocument = activeTab === "job" ? jobDocument : planningDocument;
  const emptyMessage = activeTab === "job" ? "No job document found." : "No planning section found.";
  const selectedDraft = drafts.find((draft) => draft.path === selectedDraftPath) ?? drafts[0] ?? null;

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--card)] text-[var(--card-foreground)] shadow-sm">
      <div className="border-b border-[var(--border)] p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ActiveIcon className="size-5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
              <h2 className="text-lg font-semibold leading-7 tracking-normal">{activeItem.label}</h2>
            </div>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-foreground)]">{activeItem.description}</p>
          </div>
          <div
            role="tablist"
            aria-label="Project detail sections"
            className="grid w-full grid-cols-3 gap-1 rounded-md bg-[var(--muted)] p-1 sm:w-auto"
          >
            {tabItems.map((item) => {
              const Icon = item.icon;
              const selected = item.id === activeTab;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`${baseId}-${item.id}-tab`}
                  aria-selected={selected}
                  aria-controls={`${baseId}-${item.id}-panel`}
                  className={cn(
                    "inline-flex h-9 min-w-24 items-center justify-center gap-2 rounded px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                    selected
                      ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                      : "text-[var(--muted-foreground)] hover:bg-white/70 hover:text-[var(--foreground)]",
                  )}
                  onClick={() => setActiveTab(item.id)}
                >
                  <Icon className="size-4" aria-hidden="true" />
                {item.label}
              </button>
            );
          })}
          </div>
        </div>
      </div>

      <div
        role="tabpanel"
        id={`${baseId}-${activeTab}-panel`}
        aria-labelledby={`${baseId}-${activeTab}-tab`}
        className="p-5"
      >
        {activeTab === "drafts" ? (
          selectedDraft ? (
            <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
              <div className="space-y-2">
                {drafts.map((draft) => {
                  const selected = draft.path === selectedDraft.path;
                  return (
                    <button
                      key={draft.path}
                      type="button"
                      className={cn(
                        "w-full rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                        selected
                          ? "border-[var(--primary)] bg-[var(--muted)] text-[var(--foreground)]"
                          : "border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]",
                      )}
                      onClick={() => setSelectedDraftPath(draft.path)}
                    >
                      <span className="block truncate text-sm font-medium">{draft.summary}</span>
                      <span className="mt-1 block text-xs">{draft.itemCount} draft items</span>
                    </button>
                  );
                })}
              </div>

              <div className="min-w-0 space-y-4">
                <div className="rounded-md bg-[var(--muted)] p-4">
                  <h3 className="break-words text-base font-semibold">{selectedDraft.summary}</h3>
                  {selectedDraft.request ? (
                    <p className="mt-2 text-sm leading-6 text-[var(--muted-foreground)]">{selectedDraft.request}</p>
                  ) : null}
                </div>

                <div>
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <ListChecks className="size-4 text-[var(--primary)]" aria-hidden="true" />
                    Draft Items
                  </h3>
                  {selectedDraft.draftItems.length > 0 ? (
                    <ul className="mt-2 space-y-2 text-sm">
                      {selectedDraft.draftItems.map((item) => (
                        <li key={`${selectedDraft.path}-${item.id}`} className="rounded-md bg-[var(--muted)] px-3 py-2">
                          <div className="flex min-w-0 flex-col gap-1">
                            <span className="break-words font-medium text-[var(--foreground)]">{item.id}</span>
                            <span className="break-words text-[var(--muted-foreground)]">{item.description}</span>
                            <span className="break-words text-xs text-[var(--muted-foreground)]">{item.file}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 rounded-md bg-[var(--muted)] px-3 py-2 text-sm text-[var(--muted-foreground)]">
                      No draft items found.
                    </p>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <CheckCircle2 className="size-4 text-[var(--primary)]" aria-hidden="true" />
                      Automated Checks
                    </h3>
                    <ul className="mt-2 space-y-2 text-sm text-[var(--muted-foreground)]">
                      {(selectedDraft.automatedChecks.length > 0 ? selectedDraft.automatedChecks : ["none"]).map((check) => (
                        <li key={check} className="rounded-md bg-[var(--muted)] px-3 py-2">
                          {check}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Assertions</h3>
                    <ul className="mt-2 space-y-2 text-sm text-[var(--muted-foreground)]">
                      {(selectedDraft.assertions.length > 0 ? selectedDraft.assertions : ["none"]).map((assertion) => (
                        <li key={assertion} className="rounded-md bg-[var(--muted)] px-3 py-2">
                          {assertion}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <pre className="max-h-[28rem] overflow-auto rounded-md bg-[var(--muted)] p-4 text-sm leading-6">
                  {selectedDraft.document}
                </pre>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)]">No draft history found.</p>
          )
        ) : activeDocument ? (
          <pre className="max-h-[28rem] rounded-md bg-[var(--muted)] p-4 text-sm leading-6">{activeDocument}</pre>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">{emptyMessage}</p>
        )}
      </div>
    </section>
  );
};
