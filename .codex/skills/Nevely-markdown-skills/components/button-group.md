# Button Group — TypeUI · Astra

> **TypeUI · Astra** — related actions fused into one control.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`, `buttons.md`, `dropdowns.md`, `badges.md`

A button group reads as a single object: segments butt together, separated only by a hairline `default` divider on the shared edge, and only the outer corners keep the Astra **rounded** (`radius-xxl`, 24px). The group is flat and borderless (`elevation-none`) — no outer outline, no shadow. Use a group only for genuinely related choices — toolbars, segmented controls, paired actions — never as a row of unrelated buttons.

---

## Anatomy

| Part | Role |
|---|---|
| **Root** | Inline-flex container, `role="group"` |
| **Segment** | Individual button in the set |
| **Divider** | Shared 1px border between segments (not doubled) |
| **Dropdown segment** | Trailing trigger opening menu (`dropdowns.md`) |
| **Badge segment** | Non-interactive count or status segment |

---

## Layout

The fusion is the whole point: segments overlap by 1px so adjacent borders become one line, and rounding lives only on the group's outer corners.

| Property | Token / value |
|---|---|
| Direction | Horizontal (default) or vertical |
| Shadow | `elevation-none` on root (not per segment) |
| Segment overlap | Negative inline margin 1px so borders merge |
| Outer radius | `radius-xxl` on first/last segment outer corners only |
| Inner corners | Square — segments share edge |
| Segment padding | Same as **small** button (`spacing-3` × `spacing-2`) unless icon-only |
| Icon-only segment | 36 × 36px square |
| Gap icon ↔ label | `spacing-1-5` |

Vertical groups follow the same rules with top/bottom outer radius on the first/last segments and the negative margin stacked on the block axis.

---

## Segment styling

Segments wear the quiet **tertiary**/**secondary** button tokens from `buttons.md` — the group is a navigation surface, not a place for loud fills.

| State | Background | Text | Border |
|---|---|---|---|
| Default | `neutral-primary-soft` | `body` | `default` |
| Hover | `neutral-secondary-medium` | `heading` | `default` |
| Focus | Same as hover + 4px `neutral-tertiary-soft` ring | — | — |
| Active / selected | `neutral-tertiary-medium` | `heading` | `default` |
| Disabled | Muted opacity; no hover | `fg-disabled` | `default` |

---

## Variants

### Default text group

Three or more labeled segments — e.g. Profile | Settings | Messages.

### Icon + info

A leading icon segment plus a trailing static text segment (e.g. "Download" | "456k"). The info segment usually wears `disabled` styling without being interactive.

### Text + icon action

A primary label segment (may be disabled) plus a trailing icon-only segment (bookmark, menu).

### Icon toolbar

All icon-only equal-width segments. Pair each with a tooltip (see `tooltips.md`) — icon toolbars are useless without names.

### With dropdown

One or more segments plus a chevron/more trigger that opens a menu attached to the trailing segment; follow `dropdowns.md`.

### With badge

A segment label carries an inline badge count, or a dedicated badge segment opens a menu.

### Pagination group

« Prev | 1 | 2 | 3 | Next » — the current-page segment uses the `neutral-tertiary-medium` fill; see `pagination.md`.

### QR / share cluster

Icon segments for copy link, download, and share, under the same fused-border rules.

### Colored intent group

Segments may take intent soft fills (`brand-softer`, `danger-soft`, etc.) inside one shared outer shell — use this sparingly; it is for status filters, not decoration.

### Outline group

Outline button tokens per segment, a shared outer border, and inner dividers in `default`.

### As links

Segments may be anchors with the same visual fusion — one focus ring per segment.

---

## Motion

150ms background/text shift on hover, per segment. The group shadow never animates.

---

## Accessibility

- Root is `role="group"` with an **`aria-label`** naming the set (e.g. "Text alignment").
- Icon-only segments each carry their own `aria-label`.
- Disabled segments use `aria-disabled="true"`.
- A dropdown trigger exposes `aria-expanded` and `aria-haspopup="menu"`.
- Only one segment is focused at a time; arrow keys may move within the group.

---

## Prohibited

- **No gap between fused segments** — the negative margin merges borders into one line.
- **No shadow on the group or its segments** — the group is flat (`elevation-none`); separation is the shared hairline divider only.
- **No radius on inner shared edges** — rounding an inner corner breaks the fusion that defines the component.
- **No mismatched segment heights** in one group.
- **No unrelated actions** in a single group — split them apart.
- **No primary brand fill on every segment** — at most one segment is emphasized.
- **No raw spacing/color values** — foundation tokens only.
