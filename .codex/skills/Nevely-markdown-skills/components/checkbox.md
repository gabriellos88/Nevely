# Checkbox — TypeUI · Astra

> **TypeUI · Astra** — multi-select boolean controls.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`, `dropdowns.md`

A checkbox lets users pick any number of independent options. The control is a small **16 × 16px square box** that fills `brand` with a `white` check when selected (a light check, because the violet brand needs light marks for contrast). Its tick box is **always square** — `radius-none` (0) — with **no corner rounding at all**, so it never reads as a radio or a pill chip. The larger rounded shell applies only to the cards and list groups it sits inside. When wrapped in a bordered card or list group, that container takes the signature **rounded** (`radius-xxl`, 24px).

---

## Anatomy

| Part | Role |
|---|---|
| **Control** | `<input type="checkbox">` |
| **Label** | Primary text beside control |
| **Description** | Secondary line in bordered/advanced layouts |
| **Icon (advanced)** | Optional leading glyph in card layout |
| **Link** | Optional anchor inside label |

---

## Control box (default)

| Property | Token / value |
|---|---|
| Size | 16 × 16px |
| Background (unchecked) | `neutral-tertiary` (`#1A0F33`, contrasting) |
| Background (checked) | `brand` with check mark `white` (light, for contrast on violet) |
| Border | `default` (`#281C40`), 1px (unchecked); `brand` when checked |
| Radius | `radius-none` (0) — **square corners only** |
| Focus ring | 2px `brand-soft` offset ring (4px total spread) |
| Check mark | Stroke or glyph centered; 12 × 12px effective |

Row layout: a flex row, vertically centered, with the label `spacing-2` from the control.

---

## Label typography

| Element | Size | Weight | Color |
|---|---|---|---|
| Label | `font-size-sm` | `font-weight-medium` | `heading` |
| Description | `font-size-sm` | normal | `body-subtle` |
| Link in label | `font-size-sm` | medium | `fg-brand`, underline on hover |

Apply `select-none` to the label to avoid accidental text selection on toggle.

---

## Variants

The control box never changes shape; what changes is its container.

### Checkbox example (default)

Standalone rows with `spacing-4` between stacked items.

### Disabled state

Control and label go `fg-disabled`, no pointer events, native `disabled`. A checked-disabled box keeps its checked look at reduced contrast.

### Checkbox link

The label carries an inline link; the link styling doesn't break the label association — the whole label still toggles unless the link itself is clicked (link stops propagation in the behavior layer).

### Helper text

A description stacks below the label row in `body-subtle`, `spacing-1` top margin.

### Bordered

The whole row wrapped in a card: padding `spacing-4`, **`radius-xxl`**, a raised `neutral-primary` (`#0A0118`) panel with a `default` (`#281C40`) border. A checked row is marked by a `brand` border.

### Bordered with description

A `font-weight-medium` `heading` title line over a `body-subtle` description; the control aligns to the start or center per layout.

### Bordered with icon

A 20 × 20px leading icon before the text block; the control sits at the inline start or end — consistent across a list.

### Checkbox list group

A vertical stack on a raised `neutral-primary` (`#0A0118`) panel with a `default` (`#281C40`) border around the group: rounded **`radius-xxl`** (24px) corners, with hairline `default` dividers between rows (functional row separators); each row padded `spacing-4`.

### Horizontal list group

A flex-wrap row with `spacing-4` gaps — no shared outer border.

### Checkbox dropdown

A menu row: checkbox at the inline start, then label + optional description, at `dropdowns.md` item padding. The box size is unchanged.

### Inline layout

Several checkboxes in one horizontal flex row, `spacing-4` apart.

### Colors

Intent variants recolor the checked fill and focus ring; the unchecked box always stays neutral.

| Intent | Checked fill | Focus ring |
|---|---|---|
| Brand (default) | `brand` | `brand-soft` |
| Success | `success` | `success-soft` |
| Danger | `danger` | `danger-soft` |
| Warning | `warning` | `warning-soft` |

Unchecked shell stays `neutral-secondary-medium` with a `default-medium` border.

### Advanced layout

A full-width selectable card: padding `spacing-4`, a raised `neutral-primary` (`#0A0118`) panel, `default` (`#281C40`) border, hover deepens the border toward `default-strong`, selected takes a `brand` border. The checkbox sits at the inline start; the content block holds a title + description.

---

## States

| State | Visual |
|---|---|
| Unchecked | Empty box, default border |
| Checked | Filled `brand` (or intent) + check |
| Indeterminate | Dash mark; same fill as checked |
| Focus | `brand-soft` ring on box |
| Hover | Optional subtle border `default-strong` — not required |
| Disabled | Muted label and box |
| Error (group) | Group message `fg-danger-strong`; optional `danger-subtle` border on affected rows |

---

## Motion

Check toggle is instant or a ≤ 100ms fill transition. No bounce.

---

## Accessibility

| Requirement | Implementation |
|---|---|
| Pairing | `<input>` + `<label for>` or a wrapping label |
| Group | `<fieldset>` + `<legend>` for related sets |
| Indeterminate | Set only programmatically; expose the state to AT |
| Error | `aria-invalid` on the group or individual control |
| Dropdown | Menu checkbox items follow the roving-tabindex pattern |

---

## Prohibited

- **No rounding on the tick box — ever.** The checkbox control is **always a square** (`radius-none`, 0). Never `radius-full`, `radius-xs`, `radius-sm`, or any other rounded corner on the 16px box — a rounded or pill box reads as a radio or a chip, not a checkbox. The rounded shell is for the surrounding card/list group, never the control. This applies everywhere: forms, tables, filter dropdowns, and list groups.
- **No checkbox without a label** (visible or `aria-label`).
- **No custom size below 16px** without expanding the hit area to 44px.
- **No intent fill on an unchecked box**.
- **No radio behavior** — checkboxes are independent unless "select all" logic is documented at the page level.
