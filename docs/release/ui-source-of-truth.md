# Active UI source of truth

Decision recorded: 2026-07-23

## Canonical source

- Repository: `https://github.com/gabriellos88/chat-app`
- Workspace: `C:\Users\losag\Documenti_offline\Nevely`
- Branch: `main`
- Reconciled baseline commit: `1a1bd5f078087194e049ac00f0b576f0db1dbbcc`
- Baseline description: `Astra redesign: home, auth, chat drawers, navigation, profile/plans, support and link cleanup`

This repository is the only source of truth for the active Nevely UI. The
canonical overlapping chat files are:

- `views/chat.ejs`
- `public/js/chat-client.js`
- `public/css/style.css`

Future UI changes must be made from this repository in a dedicated branch/PR
and must include their tests, rollout notes and rollback strategy.

## Reconciliation evidence

At the time of reconciliation:

- local `main` and `origin/main` both resolved to the baseline commit above;
- `git rev-list --left-right --count origin/main...HEAD` returned `0 0`;
- the working copies of the active views, stylesheet and browser scripts
  matched their blobs in the baseline commit;
- the previous workspace at
  `C:\Users\losag\Documenti_offline\chat-app` contained only empty `.git` and
  `.agents` directories;
- no source files, Git metadata or `.nevely-patchwork/.phase-final.patch`
  remained in that previous workspace.

There is therefore no outstanding UI branch or patch to merge. The Astra UI
already present in the canonical repository is the reconciled active UI.

## Acceptance check

Run:

```sh
npm run check:ui
```

The check fails if:

- a canonical UI entry point is missing or duplicated outside its expected
  location;
- an EJS view renders a missing local CSS, JavaScript or vendor asset;
- an EJS include or a statically named `res.render()` target is missing;
- a view contains duplicate static HTML IDs;
- the browser copy file is invalid JSON or lacks the required top-level
  sections.

This is a structural baseline, not a visual-regression suite. Browser-level
responsive and interaction coverage belongs to N0.6.

## Rollback reference

If a later UI release must be rolled back, use the last known-good deployment
or revert the isolated UI PR. The reconciled baseline commit above is the
historical reference; do not copy files back from the retired workspace.
