# Tables — TypeUI · Astra

> **TypeUI · Astra** — structured, comparative data.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`, `pagination.md`, `buttons.md`, `modal.md`

A table is for genuinely comparative, multi-column data — reach for lists or cards otherwise. The Astra table wraps in a crisp **rounded** (`radius-xxl`, 24px) card — **borderless and flat** (`elevation-none`): a `neutral-secondary-soft` header over `neutral-primary` rows divided by hairline `default` lines (the one place a thin rule survives, because dividing data rows is functional, not decorative), generous `spacing-6` cell padding, and `font-size-sm` throughout. Emphasis stays subtle — pick *one* readability cue (zebra, hover, or selection tint), never all three at once.

---

## Anatomy

| Part | Role |
|---|---|
| **Wrapper** | Optional scroll/border/shadow container |
| **Caption** | Optional title + description above table |
| **Head** | Column headers |
| **Body** | Data rows |
| **Foot** | Optional totals row |
| **Row header cell** | First column as `th` for row title |
| **Action cell** | Links, buttons, dropdowns per row |
| **Toolbar** | Search, filter, bulk actions above table |

---

## Layout

| Property | Token / value |
|---|---|
| Cell padding (head) | `spacing-6` horizontal, `spacing-3` vertical |
| Cell padding (body) | `spacing-6` horizontal, `spacing-4` vertical |
| Font (body cells) | font-size-sm, line-height-body, `body` |
| Font (head) | font-size-sm, font-weight-medium, `body` |
| Font (row header) | font-size-sm, font-weight-medium, `heading` |
| Row border | 1px `default` bottom between rows |
| Wrapper border | None (the table reads as a flat, borderless card) |
| Wrapper radius | `radius-xxl` |
| Wrapper shadow | `elevation-none` when bordered card style |
| Horizontal scroll | Wrapper `overflow-x: auto` on narrow viewports |

---

## Default shell

Background `neutral-primary-soft`; head background `neutral-secondary-soft` with a `default` bottom border; body rows `neutral-primary` with row dividers.

---

## Highlight variants

Pick one — they don't stack.

### Striped rows

Odd rows `neutral-primary`, even rows `neutral-secondary-soft`; keep the row borders.

### Striped columns

Alternate column backgrounds with `neutral-secondary-soft` on even columns; the first (label) column often stays soft throughout.

### Hover row

Row hover background `neutral-secondary-medium`; cursor stays default unless the row is clickable.

**No marketing card hover glow on the table.** A table — including a pricing / comparison table dropped on a marketing page, and its scroll wrapper — **never** wears the card's pointer-tracking edge-glow / breathing-border hover treatment (see `cards.md`). The only hover feedback a table has is the **row hover tint above**; the table shell itself does not light up, glow, or track the cursor. Any table-face hover cue stays a subtle neutral row background, not a `brand` glow.

---

## Table layout options

### With caption

Caption padding `spacing-5`; title font-size-lg, font-weight-medium, `heading`; description font-size-sm, `body`, `spacing-1-5` below the title.

### With foot

A footer row at the head's padding, top border `default-medium`, `font-weight-medium`.

### Sortable head

Header label + a 16px sort icon; the active sort column's text goes `heading`; clicking toggles asc/desc (behavior-agnostic).

---

## Style variants

| Variant | Border | Shadow | Head bg |
|---|---|---|---|
| **Default card** | none | `elevation-none` | `neutral-secondary-soft` |
| **Without outer border** | none on wrapper | none | transparent or soft |
| **Shadow only** | optional none | `elevation-none` | per default |
| **Compact** | same | same | cell padding `spacing-4` × `spacing-2` |

---

## Toolbar patterns

### Search

An input above the table at the inline end; ~320px wide; debounced row filter.

### Column filter

A per-column dropdown or global filter chips — see `dropdowns.md`.

### Pagination footer

Row-count text + a pagination control — see the `pagination.md` table variant.

---

## Row selection

A checkbox column at the inline start; the head checkbox selects all visible rows; each checkbox is a **16 × 16px square** (`radius-none`) — never rounded. Selected rows may take a `brand-softer` background; a bulk-action bar appears above the table once the selection count is greater than zero.

---

## Content patterns

### Users table

Avatar + name + email in the first column; a role badge; an action dropdown at the inline end.

### Products table

Thumbnail, name, category, price, and a stock-status badge.

### With modal detail

A row action opens a `modal.md` — the table stays under the backdrop.

### Status / intent rows

Row background tints using soft intent tokens (`danger-soft`, etc.) — sparingly, for genuine alerts in data.

---

## Links & actions in cells

| Element | Spec |
|---|---|
| Row action link | font-weight-medium, `fg-brand`, underline on hover |
| Icon action | 32px hit target, icon 16px |
| Destructive row action | `fg-danger` text or a danger outline button |

**Table icons cap at 16px.** Every icon inside a table — data tables *and* pricing / comparison tables — is **16px maximum, never larger**: cell marks (`check` / `minus` / `x`), sort carets, row-action glyphs, and inline status icons. When an icon sits inside a tinted chip (e.g. a `success-soft` circle behind a `check`), it may drop **smaller** (~14px) to breathe inside the container, but 16px is the hard ceiling.

---

## Accessibility

- Use native `<table>`, `<thead>`, `<tbody>`, `<th scope="col|row">`.
- Associate the caption via `<caption>` or `aria-labelledby` on the table.
- Sort buttons: `aria-sort="ascending|descending|none"`.
- Select-all checkbox: indeterminate state on partial selection.
- Never use table layout for non-tabular content.

---

## Prohibited

- **No zebra + hover + selection tint at once** — choose one primary readability pattern.
- **No marketing card hover glow on a table** — the pointer-tracking edge glow / breathing-border treatment from `cards.md` never applies to a table or its wrapper, even on a marketing page. Row hover tint is the only hover feedback.
- **No shadow above `elevation-none`** on the wrapper, and no corner below `radius-xxl`.
- **No horizontal scroll without a visual hint** on mobile.
- **No font-size below `font-size-xs`** in cells.
- **No nested tables** unless the spec explicitly requires sub-grids.
- **No raw hex or px for spacing/colors** (fixed icon sizes excepted), and no framework utility names.
