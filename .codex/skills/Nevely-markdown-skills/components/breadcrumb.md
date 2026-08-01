# Breadcrumb — TypeUI · Astra

> **TypeUI · Astra** — the "you are here" trail.
> Depends on: `colors.md`, `radius.md`, `spacing.md`, `typography.md`, `badges.md`, `buttons.md`, `dropdowns.md`

A breadcrumb is deliberately quiet in Astra: small `font-size-sm` links in `body`, a light chevron between steps, and the **current page rendered as plain `body-subtle` text** — never a link. It usually floats transparently above a page title; when it needs grounding it sits in a soft `neutral-secondary-medium` pill with the signature **rounded** (`radius-xxl`, 24px) corners. Keep it shallow — a breadcrumb is wayfinding, not navigation.

---

## Anatomy

| Part | Role |
|---|---|
| **Root** | Navigation landmark wrapping ordered list |
| **List** | Horizontal ordered trail |
| **Item** | One hierarchy step |
| **Link** | Clickable ancestor |
| **Current** | Final step — text only |
| **Separator** | Chevron between items |
| **Home icon** | Optional on first link only |
| **Inline badge** | Optional on current item (see `badges.md`) |
| **Toolbar** | Optional actions row (dropdown/button) beside trail |

---

## Layout

| Property | Token / value |
|---|---|
| Direction | Horizontal inline-flex |
| Gap between items | `spacing-1` narrow; `spacing-2` wide viewports |
| Gap inside item (separator ↔ label) | `spacing-1-5` |
| Gap home icon ↔ "Home" label | `spacing-1-5` |
| Solid variant padding | `spacing-3` |
| Solid variant border | None (the `neutral-secondary-medium` fill grounds it) |
| Solid variant radius | `radius-xxl` |
| Solid variant background | `neutral-secondary-medium` |

### Separator

| Property | Value |
|---|---|
| Icon | Chevron right, 14 × 14px stroke |
| Color | `body` |
| RTL | Mirror chevron horizontally |

### Home icon (optional)

16 × 16px stroke house icon before the first link label.

---

## Typography

Links lift to `fg-brand` on hover; the current step stays muted and carries `aria-current="page"`. Everything holds at `font-size-sm` — a trail never borrows the heading scale.

| Element | Size | Weight | Line height | Color |
|---|---|---|---|---|
| Link | font-size-sm | font-weight-medium | line-height-component | `body` |
| Link hover | font-size-sm | font-weight-medium | line-height-component | `fg-brand` |
| Current page | font-size-sm | font-weight-medium | line-height-component | `body-subtle` |

All copy uses **`font-family`**.

---

## Variants

### Default (transparent)

No background or border — the trail alone, floating above the page title.

### Solid background

Wrapped in the padded, bordered, squared, bordered pill — use it when the trail sits over busy imagery or needs visual grouping.

### Header toolbar

A flex row: trail on the start, an optional action cluster (dropdown trigger, button) on the end. The trail may wrap on narrow viewports with a `spacing-2-5` gap between wrapped rows.

### With dropdown steps

Ancestor steps become dropdown triggers instead of links (styled per `dropdowns.md`). A slash `/` separator is allowed between major segments in place of the chevron.

### With inline badge

The current item may carry a small badge after its label (`spacing-2-5` gap) — e.g. a category tag on an issue title.

### With navigation controls

Optional prev/next icon buttons at the trail end for sequential document flows — use the icon-button spec from `buttons.md`.

---

## States

| State | Spec |
|---|---|
| Link default | `body` text |
| Link hover | `fg-brand` text |
| Current | `body-subtle`; `aria-current="page"` |
| Disabled ancestor | Not used — omit unreachable steps or show as plain text |

---

## Accessibility

- Root: `<nav aria-label="Breadcrumb">` (or a localized equivalent).
- List: ordered-list semantics.
- Current item: `aria-current="page"` on the list item or current span.
- Separators are decorative — `aria-hidden="true"`.
- Dropdown steps expose expanded state and menu labeling per `dropdowns.md`.

---

## Prohibited

- **No current page as a link** — the last item is never interactive.
- **No raw hex or ad-hoc spacing** — foundation tokens only.
- **No trail deeper than ~4 visible levels** without collapsing the middle into a dropdown.
- **No chevron-only separator without list semantics** — keep the ordered structure.
- **No heading scale in the trail** — it holds at `font-size-sm`.
- **No shadow on the breadcrumb bar** — flat, or the solid `radius-xxl` fill, nothing more.
- **No framework class names** in specs.
