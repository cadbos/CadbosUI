#!/usr/bin/env python3
"""PostToolUse guard: flag Svelte 4 syntax in edited .svelte files.

Cadbos is runes-only. After an Edit/Write to a `.svelte` file this hook scans for
legacy Svelte 4 patterns and, if found, reports them back to the agent (exit 2) so
they get migrated to Svelte 5 runes. Fails open: any error → exit 0, so it never
blocks normal work.
"""
import json
import re
import sys

# (regex, human-readable issue, Svelte 5 replacement)
CHECKS = [
    (re.compile(r"(?<![\w$])on:[a-zA-Z]"), "on: event directive", "use onclick / oninput / etc. (event attributes)"),
    (re.compile(r"(?m)^\s*export\s+let\s"), "export let (Svelte 4 props)", "use $props()"),
    (re.compile(r"<slot\b"), "<slot> element", "use {@render ...} with snippets"),
    (re.compile(r"(?m)^\s*\$:\s"), "$: reactive statement", "use $derived / $effect"),
]


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0

    path = (data.get("tool_input") or {}).get("file_path", "")
    # Only plain .svelte components have this syntax; skip .svelte.ts/.svelte.js.
    if not path.endswith(".svelte"):
        return 0

    try:
        with open(path, "r", encoding="utf-8") as fh:
            src = fh.read()
    except Exception:
        return 0

    found = []
    for rx, issue, fix in CHECKS:
        if rx.search(src):
            found.append(f"  - {issue} → {fix}")

    if not found:
        return 0

    msg = (
        f"[cadbos] Svelte 4 syntax detected in {path} (project is runes-only):\n"
        + "\n".join(found)
        + "\nMigrate to Svelte 5 runes and re-validate with svelte-autofixer."
    )
    print(msg, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
