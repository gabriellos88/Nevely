# Number Input — TypeUI · Astra

> **TypeUI · Astra** — numeric entry: plain numbers, steppers, counters, currency, PIN, and slider pairs.
> Depends on: `input-field.md`, `range.md`, `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`

A number input is the Astra **field shell** from `input-field.md` typed for numbers. When steppers or addons attach, they **fuse into one rounded (`radius-xxl`, 24px) control** sharing a single `default`-bordered, flat (`elevation-none`) shell, with hairline `default-medium` dividers between segments. Per-cell patterns (PIN, card) repeat the same soft shell on each box. Whatever the composition, custom steppers never break keyboard entry — ↑/↓ always work.

---

## Anatomy

| Part | Role |
|---|---|
| **Label** | Standard field label |
| **Control** | `type="number"` or text with numeric pattern |
| **Stepper buttons** | Increment / decrement adjacent to field |
| **Prefix / suffix** | Currency symbol, unit label |
| **PIN cells** | Multiple single-digit boxes |
| **Linked range** | Horizontal slider below or beside field (`range.md`) |

---

## Core layout

| Property | Token / value |
|---|---|
| Field shell | Same as `input-field.md` |
| Steppers row | Horizontal flex; field flex-grow; buttons fixed width |
| Stepper button size | Match field block height — square or `spacing-10` min width |
| Stepper icon | 16 × 16px, `body` |
| Gap (field ↔ stepper) | `spacing-0` when fused; shared outer `radius-xxl` and `elevation-none` |
| Currency prefix | Input group addon — `neutral-tertiary`, `spacing-3` padding |

---

## Variants

### Default number input

Label + full-width number field; optional `min`, `max`, `step` leave styling unchanged.

### ZIP / postal code

A short max-width field (a layout constraint, not a token change) on the same shell.

### Control buttons

The field sandwiched between minus and plus buttons. The outer wrapper is a unified rounded shell with a `default` (`#281C40`) border, flat; segments read apart by `default` dividers, and the stepper buttons sit on `neutral-quaternary`, hover `neutral-tertiary-medium`.

### Control buttons with icon

The same as control buttons, with icons replacing the "+" / "−" text.

### Counter input

A compact quantity stepper; tighter inline padding (`spacing-2`) is allowed, height aligned to the adjacent buttons.

### Currency input

A prefix addon carrying the currency symbol (`$`, `€`), fused to the field per the input-group rules in `input-field.md`.

### Credit card input

A single field or grouped segments in equal flex columns with a `spacing-2` gap; each segment uses the standard shell.

### PIN code input

A row of 4–6 single-character fields. Each cell: ~40px wide, centered, `font-size-lg`, `font-weight-medium`, **`radius-xxl`**, with the same border and focus ring as the field shell; `spacing-2` between cells.

### Currency converter

A dual currency-input pair (from / to), each with its own currency or crypto dropdown. Two currency-input rows side by side or stacked, `spacing-4` gap, with an optional swap icon button between them.

### Number input with slider

A field above or beside a `range.md` track; the current value may mirror into the field. Vertical gap `spacing-4`.

### Min and max values

Behavioral only — optional helper text documents the limits (`font-size-sm`, `body-subtle`).

### Advanced control buttons

Stacked or grouped actions (reset, max) use `buttons.md` secondary/outline at `font-size-sm`; the field shell is unchanged.

---

## States

Disabled and validation inherit from `input-field.md`. Stepper buttons go `fg-disabled` with no hover when the value hits min/max. A custom stepper may hide the native spinner — but keyboard ↑/↓ must still work.

---

## Motion

Stepper press: optional ≤ 100ms background transition on the buttons. No field-shell animation.

---

## Accessibility

| Requirement | Implementation |
|---|---|
| Label | Required |
| Steppers | `aria-label` "Increase" / "Decrease"; not icon-only |
| PIN | One group label + an `aria-label` per cell, or a single hidden-input pattern |
| Live value | `aria-valuenow` when paired with a slider |
| Errors | `aria-invalid` + a described error message |

---

## Prohibited

- **No spinner-only interaction** when custom steppers are shown — keyboard access is required.
- **No PIN/card cells without a group label**.
- **No currency symbol inside the placeholder** when a prefix addon is used.
- **No off-shell colors on steppers** — neutral surfaces only, unless a `buttons.md` primary is used for a separate action.
- **No corners other than `radius-xxl`** on the field, fused group, or cells.
