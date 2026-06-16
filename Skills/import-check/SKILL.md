# Import Check

Use this Skill when `bun run lint:imports` fails or when import lint configuration must be adjusted.

## Required Check

For code changes in this workspace, the final check stage must run:

```sh
bun run lint:imports
```

Do not mark a code-change request complete while this command is failing.

## What The Check Enforces

- imported modules resolve through Node and TypeScript resolution
- duplicate imports are rejected
- cyclic imports are rejected
- import groups are separated and alphabetized
- invalid named/default/namespace imports are rejected where static analysis can detect them

## Fix Guidance

- For unresolved local aliases, check `tsconfig.json` `baseUrl` and `paths` first.
- For TypeScript path resolution, keep `eslint-import-resolver-typescript` configured in `eslint.config.mjs`.
- Prefer fixing the import path or export surface over disabling `import/no-unresolved`.
- Use inline disables only for a narrow line and only when the import is intentionally handled outside TypeScript or Node resolution.
