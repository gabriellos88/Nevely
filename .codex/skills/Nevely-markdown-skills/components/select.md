# Select — TypeUI · Astra

> **TypeUI · Astra** — single- and multi-option pickers.
> Depends on: `input-field.md`, `dropdowns.md`, `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`

A select wears the Astra **field shell** from `input-field.md` — crisp rounded (`radius-xxl`, 24px), surface-matching fill with a `default` border, flat (`elevation-none`), brand focus ring — with a trailing chevron. A native `<select>` keeps that shell; a custom select pairs a shell-shaped trigger with a menu drawn entirely by `dropdowns.md`. The one deliberate departure is the **underline** variant, which drops to a single bottom border for dense, low-chrome forms.

---

## Anatomy

| Part | Role |
|---|---|
| **Label** | Standard field label |
| **Control** | `<select>` or button trigger |
| **Chevron** | Trailing affordance indicating an expandable list |
| **Options list** | Native OS menu or custom dropdown panel |
| **Helper text** | Optional format or selection hint |

---

## Native select shell

| Property | Token / value |
|---|---|
| Shell | Same as `input-field.md` |
| Padding (inline end) | Extra `spacing-8` to clear the chevron if custom-drawn |
| Chevron | 16 × 16px, `body`, inline-end inset `spacing-3` |
| Option text | `font-size-sm`, `heading` |
| `multiple` + `size` | Multi-line list box — same border/radius; min-height from row count × line height |

---

## Variants

### Select input (default)

Label + single-select dropdown; the first disabled option may serve as a placeholder ("Choose a country").

### Multiple options

The `multiple` attribute — a list box with `spacing-0` internal rows, each option padded `spacing-2` `spacing-3`. Selected options use a `brand-softer` background (prefer this over the OS default when skinning).

### Size attribute

Shows several rows without opening the menu; height grows with the option count, width stays 100%.

### Disabled state

`fg-disabled` text and muted interaction — the same disabled treatment as `input-field.md`.

### Underline select

The minimal variant: no side border, **bottom border only** (1px `default-medium`), transparent or `neutral-primary` background. Focus turns the bottom border `brand` with an optional inward 4px `brand-medium` ring. Radius is `radius-none` on this shell — the only case where a select shows no boxed shell at all — just a bottom rule.

### Select with dropdown (custom)

The trigger matches the field shell (`aria-haspopup="listbox"`); the menu panel uses flat, `radius-xxl`, item padding `spacing-2` `spacing-3`, hover `neutral-tertiary-medium`, and an optional 16px checkmark at the inline start of the selected item.

### Sizes

| Size | Block padding | Font size |
|---|---|---|
| Small | `spacing-2` | `font-size-sm` |
| Default | `spacing-2-5` | `font-size-sm` |
| Large | `spacing-3` | `font-size-base` |
| Extra large | `spacing-3-5` | `font-size-base` |

---

## States

| State | Visual |
|---|---|
| Focus | Border `brand`, 4px `brand-medium` ring |
| Open (custom) | Trigger border `brand`; chevron rotates 180° (optional ≤ 150ms) |
| Disabled | `fg-disabled`, no pointer events |
| Invalid | Error shell from the `input-field.md` validation table |

---

## Motion

Chevron rotation ≤ 150ms. Menu open/close follows `dropdowns.md` (≤ 200ms fade/slide).

---

## Accessibility

| Requirement | Implementation |
|---|---|
| Label | Required on a native select |
| Custom | `role="combobox"` or `listbox` pattern; `aria-expanded`, `aria-controls` |
| Keyboard | Arrow keys navigate options; Enter selects |
| Multi-select | Announce selection-count changes |
| Required | `aria-required` when applicable |

---

## Prohibited

- **No custom select without keyboard support**.
- **No menu panel styled ad hoc** — use `dropdowns.md` tokens (`radius-xxl`, flat).
- **No chevron on the underline variant** unless the spec adds a trailing icon with adjusted padding.
- **No placeholder option without disabled/empty-value** semantics.
