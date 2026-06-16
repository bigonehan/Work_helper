# Workspace Skills

Place project-specific Skill instructions in this directory.

When a work_helper delegated agent receives an instruction to use a specific Skill, it must first inspect this `Skills/` directory in the target workspace. If a matching Skill document or directory exists here, the agent must read and follow that local instruction before falling back to any built-in, global, or externally installed Skill with the same name.

Recommended layout:

```text
Skills/
  skill-name/
    SKILL.md
```
