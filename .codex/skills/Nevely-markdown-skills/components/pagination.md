# Pagination — TypeUI · Astra

> **TypeUI · Astra** — moving through paged content and table results.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`, `buttons.md`, `dropdowns.md`, `input-field.md`

Pagination walks users through ordered pages — archives, search results, table data. Its default form is a **fused group** built like `button-group.md`: cells share borders, the whole row rounds to **rounded** (`radius-xxl`, 24px) at its outer corners only, and the current page is marked by `fg-brand` text on a `neutral-tertiary-medium` cell — never a heavy brand bar. Hide it entirely when there's a single page.

---

## Anatomy

| Part | Role |
|---|---|
| **Root** | Navigation landmark |
| **List** | Fused or spaced page controls |
| **Previous** | Link/button to prior page |
| **Next** | Link/button to following page |
| **Page number** | Numeric page trigger |
| **Ellipsis** | Gap indicator for truncated ranges |
| **Summary text** | "Showing X–Y of Z" (table variant) |
| **Auxiliary** | Dropdown page size, jump-to input |

---

## Sizes

| Size | Page cell | Prev/next height | Font |
|---|---|---|---|
| Small | 36 × 36px | 36px min height | font-size-sm |
| Large | 40 × 40px | 40px min height | font-size-sm |

Prev/next with text: horizontal padding `spacing-3` (small) or `spacing-4` (large).

---

## Default fused group

An inline-flex list with merged borders, exactly like `button-group.md`:

| Property | Token / value |
|---|---|
| Segment border | 1px `default-medium` |
| Segment background | `neutral-secondary-medium` |
| Segment hover | `neutral-tertiary-medium` + `heading` text |
| Active page | `neutral-tertiary-medium` background + `fg-brand` text |
| Outer radius | `radius-xxl` on first/last segment outer corners |
| Overlap | 1px negative margin between segments |
| Shadow | `elevation-none` (optional `elevation-none` on a standalone prev/next pair) |

Current page carries `aria-current="page"`.

---

## Variants

### Default numbered

Previous | 1 | 2 | 3 | … | Next — show up to ~5 contiguous numbers, with an ellipsis for gaps.

### With icon prev/next

A 16px chevron replaces the "Previous"/"Next" text, with **`sr-only`** text for screen readers and RTL-mirrored chevrons.

### Previous and next only

Two separate buttons with a `spacing-2` gap and no numbers — secondary button tokens plus `elevation-none`.

### Previous/next with icons + text

Secondary buttons with leading/trailing 16px icons per `buttons.md`.

### Table data footer

A horizontal flex: summary text at the inline start ("Showing **1–10** of **1000**"), pagination at the inline end. The summary is `font-size-sm`, `body`; emphasized numbers are `font-weight-semibold`, `heading`.

### Table pagination with icons

The table footer with a fused icon pagination control.

### With dropdown (page size)

A "Rows per page" dropdown (`dropdowns.md`) beside the pagination — options 10, 25, 50, 100.

### With input (jump to page)

A compact numeric input (`input-field.md`) plus a "Go" button (`buttons.md` small secondary).

### Input field and button

A single row: page-number field + submit.

### Select + prev/next

A select for the page index between previous/next buttons.

### Single pagination

One page indicator when only a single page exists — disable prev/next.

---

## States

| State | Visual |
|---|---|
| Default link | `body` on `neutral-secondary-medium` |
| Hover | `heading` on `neutral-tertiary-medium` |
| Active page | `fg-brand` on `neutral-tertiary-medium` |
| Disabled prev/next | `fg-disabled`; no hover; first/last page edge |

---

## Accessibility

- Root: `<nav aria-label="Pagination">` (localized).
- Current page: `aria-current="page"`.
- Disabled controls: `aria-disabled="true"` or omit the href.
- Icon-only prev/next: visible text in an `sr-only` span.
- Table summary: associate with the table via `aria-describedby` when helpful.

---

## Prohibited

- **No primary brand fill on every page cell** — only the active page may use brand **text**, never a brand background bar.
- **No pagination for a single page** — hide the component entirely.
- **No duplicate active-page indicators**.
- **No more than 7 numbered cells** without an ellipsis.
- **No opening page numbers in a new tab** — pagination is same-view navigation.
- **No raw color/spacing values**, and no framework names — foundation tokens only.
