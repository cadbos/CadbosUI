---
name: cadbos-pull-requests
description: >
  How Cadbos opens a GitHub pull request for the current branch — pre-flight checks,
  branching/pushing, a Conventional-Commits title, a reviewer-ready body, and the
  required Claude Code footer. Load when asked to open/create/raise a PR (or merge
  request), when wrapping up a feature branch, or when preparing changes for review.
---

# Cadbos pull requests

Open PRs with the `gh` CLI (the repo standard for GitHub work). This pairs with
`cadbos-commits` (commit messages), `cadbos-self-review` (the pre-finish checklist),
and `cadbos-testing` (what to run). Open a PR **only when the user asks** — the same
policy as committing.

The point of a PR is to make a reviewer's job easy: a focused diff, a title they can
scan in a changelog, and a body that answers "what changed and why" without them
having to read every line. Everything below serves that.

## Pre-flight (before opening)

- **Work is committed** per `cadbos-commits`. Nothing that belongs in the PR is left
  unstaged; no unrelated changes are swept in.
- **You're on a feature branch, not the default branch.** `main` is the integration
  branch (this repo's local work often sits on `master` — still branch off for a PR).
  If you're on `main`/`master`, create a branch first; pushing the default branch
  straight to a PR is what we're avoiding.
- **Self-review passed** (`cadbos-self-review`) and **tests are green**
  (`cadbos-testing` — `pnpm test`, plus `pnpm e2e` when behavior changed). State the
  result in the body; if something was skipped, say so rather than implying green.
- **One concern per PR.** If the branch mixes unrelated work, split it — small,
  single-purpose PRs review faster and revert cleanly.
- **No secrets in the diff** (`cadbos-security`): keys, tokens, `.env` never ship.

## Branch & push

Name the branch for the change in kebab-case, optionally with a type prefix
(`feat/graph-view`, `fix/render-timeout`). Push with upstream tracking so `gh` can
find it:

```bash
git push -u origin <branch>
```

## Gather context for the body

Summarize from the actual diff, not memory:

```bash
git log main..HEAD --oneline      # commits the PR introduces
git diff main...HEAD --stat       # files/scope at a glance
```

Note any issue the PR closes (`Closes #NN`) and, for UI changes, capture a
screenshot or short clip — the three-view UI is hard to review from a diff alone.

## Title

Conventional Commits, imperative mood, ≤ ~72 chars — same convention as
`cadbos-commits`. For a single-commit PR, reuse that commit's summary. Scope is
optional and short.

```
feat(graph): add node-to-compose edge validation
fix(proxy): map render timeout to a retryable error
```

## Body

Use this template — it keeps reviewers oriented:

```markdown
## Summary
<1–3 sentences: what changed and why. Lead with the why.>

## Changes
- <notable change, one bullet each>

## Testing
- <command run> → <result>

## Notes
<optional: follow-ups, out-of-scope, linked issues (Closes #NN), screenshots for UI>
```

End every PR body with the required footer (its own line):

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Create the PR

`gh` doesn't support interactive flags here, so pass the title and body explicitly.
A heredoc keeps the multi-line body (and the footer) intact:

```bash
gh pr create --base main --head <branch> --title "<title>" --body "$(cat <<'EOF'
## Summary
…

## Testing
- pnpm test → green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- `--base main` is the default target; confirm with the user if the PR should target
  a different base.
- Add `--draft` for work that isn't ready for review yet.
- After creation, report the PR URL back as a markdown link (resolve the repo URL with
  `gh` rather than guessing) so the user can click through.

## Avoid

- Opening a PR off `main`/`master`, or force-pushing a shared branch.
- Vague titles ("update", "fixes") or a body that just restates the diff.
- Bundling unrelated changes; targeting the wrong base branch.
- Dropping the Claude Code footer, or pasting secrets/log output into the body.
