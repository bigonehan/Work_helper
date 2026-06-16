# Config Project Link Roots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve `project.md` section references through project-type-specific folder roots defined under `configs/`.

**Architecture:** Add a focused link-root config reader in `src/server/project.ts`, backed by `configs/project-link-roots.yaml`. Existing project detail loaders read the same config so `code` and `mono` folder locations come from configuration instead of hardcoded paths.

**Tech Stack:** Bun tests, TypeScript, simple YAML-like config parsing matching the existing flat config style.

---

### Task 1: Link Root Config Helpers

**Files:**
- Create: `configs/project-link-roots.yaml`
- Modify: `src/server/project.ts`
- Test: `test/server.project.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that load default type-specific link roots, parse a custom config file, and resolve `[[...]]` links inside section roots.

- [x] **Step 2: Run tests to verify failure**

Run: `bun test test/server.project.test.ts`

- [x] **Step 3: Implement minimal helpers**

Add `getProjectLinkRoots`, `resolveProjectLinkRoot`, and `resolveProjectWikiLink` using defaults merged with `configs/project-link-roots.yaml`.

- [x] **Step 4: Run tests to verify pass**

Run: `bun test test/server.project.test.ts`

### Task 2: Project Detail Uses Config Roots

**Files:**
- Modify: `src/server/uiProjectData.ts`
- Test: `test/uiProjectData.test.ts`

- [x] **Step 1: Write failing test**

Add a project detail test where a code project stores domains under a custom configured root.

- [x] **Step 2: Run tests to verify failure**

Run: `bun test test/uiProjectData.test.ts`

- [x] **Step 3: Implement minimal integration**

Replace hardcoded domain/source folder roots with `getProjectLinkRoots(configPath(rootDir))`.

- [x] **Step 4: Run tests to verify pass**

Run: `bun test test/uiProjectData.test.ts`

### Task 3: Check

**Files:**
- Modify: `package.json`
- Modify: `.project/job.md`
- Create: `.project/drafts/config_project_link_roots/config_project_link_roots.md`
- Create: `.project/drafts/config_project_link_roots/link_root_config.yaml`

- [x] **Step 1: Bump version**

Increment `package.json` version from `0.1.32` to `0.1.33`.

- [x] **Step 2: Run final checks**

Run: `bun test`, `bunx tsc --noEmit`, `bun run lint:imports`.
