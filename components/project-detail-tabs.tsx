"use client";

import { ClipboardList, FileText } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

type DetailTab = "job" | "planning";

interface ProjectDetailTabsProps {
  readonly jobDocument: string | null;
  readonly planningDocument: string | null;
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
];

export const ProjectDetailTabs = ({ jobDocument, planningDocument }: ProjectDetailTabsProps) => {
  const [activeTab, setActiveTab] = useState<DetailTab>("job");
  const baseId = useId();
  const activeItem = tabItems.find((item) => item.id === activeTab) ?? tabItems[0];
  const ActiveIcon = activeItem.icon;
  const activeDocument = activeTab === "job" ? jobDocument : planningDocument;
  const emptyMessage = activeTab === "job" ? "No job document found." : "No planning section found.";

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
            className="grid w-full grid-cols-2 gap-1 rounded-md bg-[var(--muted)] p-1 sm:w-auto"
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
        {activeDocument ? (
          <pre className="max-h-[28rem] rounded-md bg-[var(--muted)] p-4 text-sm leading-6">{activeDocument}</pre>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">{emptyMessage}</p>
        )}
      </div>
    </section>
  );
};
