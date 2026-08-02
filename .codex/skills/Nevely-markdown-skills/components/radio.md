# Radio — TypeUI · Astra

> **TypeUI · Astra** — single-select options.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`, `dropdowns.md`

A radio lets users choose exactly one option from a set. The control is a naturally round (`radius-full`) 16px circle that shows a `brand` inner dot when selected — one of Astra's inherently circular controls. As with checkboxes, the **rounded** (`radius-xxl`, 24px) signature lives on the bordered cards and list groups radios sit in, never on the control itself. Every radio in a set shares one `name`, and only one is ever selected.

---

## Anatomy

| Part | Role |
|---|---|
| **Control** | `<input type="radio">` |
| **Label** | Primary text beside control |
| **Description** | Secondary line in helper, bordered, or advanced layouts |
| **Icon (advanced)** | Optional leading glyph |
| **Link** | Optional anchor inside label |
| **Group container** | Fieldset, list, or dropdown menu |

---

## Control (default)

| Property | Token / value |
|---|---|
| Size | 16 × 16px outer circle |
| Background (unchecked) | `neutral-tertiary` (`#1A0F33`, contrasting) |
| Border | `default` (`#281C40`), 1px (unchecked); `brand` when selected |
| Radius | `radius-full` |
| Inner dot (checked) | 8 × 8px circle, `brand` fill, centered |
| Focus ring | 2px `brand-soft` spread |
| Row gap (control → label) | `spacing-2` |

All radios sharing a `name` form one mutually exclusive set.

---

## Label typography

| Element | Size | Weight | Color |
|---|---|---|---|
| Label | `font-size-sm` | `font-weight-medium` | `heading` |
| Description | `font-size-sm` | normal | `body-subtle` |
| Link in label | `font-size-sm` | medium | `fg-brand` |

---

## Variants

### Radio example (default)

A vertical stack, `spacing-4` between options.

### Disabled state

Muted control and label with the `disabled` attribute; a selected-disabled radio keeps its dot at lower contrast.

### Radio link

An inline link in the label — same behavior as the checkbox link.

### Helper text

A secondary `body-subtle` line under the primary label, within the row.

### Bordered

A row card: padding `spacing-4`, **`radius-xxl`**, a raised `neutral-primary` (`#0A0118`) panel with a `default` (`#281C40`) border. Selected is marked by a `brand` border.

### Radio list group

A vertical grouped list on a raised `neutral-primary` (`#0A0118`) panel with a `default` (`#281C40`) border around the group (rounded **`radius-xxl`** (24px) corners) and hairline `default` row dividers. The section heading above sits at `font-size-base`, `font-weight-semibold`, `heading`, `spacing-3` below.

### Horizontal list group

Options in a flex row, `spacing-4` gap, under the same fieldset legend.

### Radio in dropdown

A menu row: radio at the inline start, then label + optional helper, at `dropdowns.md` spacing — one selected per group inside the menu.

### Inline layout

A horizontal row of radios for short option sets (2–4 items).

### Advanced layout

A full-width selectable card where the circle recedes — the radio is visually hidden or minimal and the whole card shows selection through border and fill.

| State | Border | Background |
|---|---|---|
| Default | `default-medium` | `neutral-secondary-medium` |
| Hover | `default-strong` | `neutral-tertiary-medium` |
| Selected | `brand-subtle` | `brand-softer` |

Padding `spacing-4`; title `font-weight-medium`; description `body-subtle`.

### Advanced layout with icons

A 24 × 24px icon at the inline start of the card content; the radio control sits top-aligned or at the inline end.

---

## States

| State | Visual |
|---|---|
| Unchecked | Empty circle |
| Checked | Inner dot `brand` |
| Focus | Ring on circle |
| Disabled | Muted |
| Error | Group message `fg-danger-strong` below the set |

---

## Motion

Selection change is instant or a ≤ 100ms dot appearance. No slide between options.

---

## Accessibility

| Requirement | Implementation |
|---|---|
| Grouping | `<fieldset>` + `<legend>` describing the set |
| Name | Shared `name` on all radios in the set |
| Label | Each radio has a `<label for>` |
| Focus | Arrow keys move within the group (native behavior) |
| Hidden radio in card | The card stays focusable; `aria-checked` on the label wrapper when the radio is visually hidden |
| Error | `aria-invalid` on the fieldset when validation fails |

---

## Prohibited

- **No square radio controls** — the control is always `radius-full`. (The rounded shell belongs to the surrounding card/list group.)
- **No multiple selected radios in one `name` group**.
- **No checkbox styling for single-select** — use the radio pattern.
- **No group without a legend or `aria-labelledby`**.
- **No 16px hit area without a label click target** — the label must toggle selection.
