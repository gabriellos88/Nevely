# Tooltips — TypeUI · Astra

> **TypeUI · Astra** — supplementary text on hover, focus, or click.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`

A tooltip is a small floating label that clarifies an icon-only control or a truncated string — supplementary only, never the home for essential instructions (those belong in visible UI or `alerts.md`). The Astra bubble keeps the signature **rounded** (`radius-xxl`, 24px) corner and is **flat and borderless** (`elevation-none`); it comes dark by default or light for dark surfaces. It holds one short line, passes pointer events through, and never traps focus.

---

## Anatomy

| Part | Role |
|---|---|
| **Trigger** | Element receiving pointer/focus (button, icon, link) |
| **Bubble** | Floating label container |
| **Arrow** | Optional pointer toward trigger |
| **Content** | Short text (one line preferred) |

---

## Layout

| Property | Token / value |
|---|---|
| Padding | `spacing-3` horizontal, `spacing-2` vertical |
| Max width | ~240px — wrap to two lines max |
| Radius | `radius-xxl` |
| Shadow | `elevation-none` |
| Arrow size | 8px — matches bubble fill |
| Offset from trigger | `spacing-2` |
| Z-index | Above page content; below modals |

---

## Styles

| Style | Background | Text | Border |
|---|---|---|---|
| **Dark (default)** | `dark` | `white` | none |
| **Light** | `neutral-primary-medium` | `heading` | none |

Use the **light** style on dark triggers for contrast.

---

## Typography

| Element | Size | Weight | Line height |
|---|---|---|---|
| Content | font-size-sm | font-weight-medium | line-height-component |

Use **`font-family`** and keep copy under ~80 characters.

---

## Placement

Anchor the bubble to the trigger and flip it near a viewport edge.

| Placement | Position |
|---|---|
| top | Above trigger, centered |
| bottom | Below trigger, centered |
| left | Inline-start of trigger |
| right | Inline-end of trigger |

RTL mirrors left/right.

---

## Triggering

| Mode | When to use |
|---|---|
| **Hover + focus (default)** | Desktop icon buttons, dense toolbars |
| **Click** | Touch-primary contexts or toggled help |
| **Focus only** | Optional — show on keyboard focus without hover |

Hide on blur, Escape, or a second click (in click mode). Never trap focus inside the tooltip.

---

## Variants

### Default

A dark bubble + arrow on hover/focus of the trigger.

### Light

A light bubble for use on dark surfaces.

### Animated show/hide

A 300ms opacity fade; respect reduced-motion (instant or no animation).

### Without arrow

Bubble only — when an arrow would clip or overlap awkwardly.

---

## Motion

| Transition | Duration | Properties |
|---|---|---|
| Show / hide | 300ms | Opacity |
| Timing | ease-out | — |

---

## Accessibility

- The trigger must be keyboard focusable if the tooltip is focus-triggered.
- Use **`aria-describedby`** to link the trigger to the tooltip id when the content is supplementary.
- Never put required-field instructions only in a tooltip.
- Tooltip content doesn't receive focus (it's not a dialog).
- For an icon-only trigger, an `aria-label` on the trigger may replace the tooltip — don't double up redundantly.

---

## Prohibited

- **No elevation above `elevation-none`** — tooltips are lightweight hints, not floating panels.
- **No paragraphs or links inside a tooltip** — use a popover or modal for rich content.
- **No tooltip as the sole label** for an icon-only control.
- **No hover-only critical info on touch** without a click alternative.
- **No blocking interaction** — pointer events pass through the overlay layer where possible.
- **No raw hex or shadow strings**, and no framework data-attribute names — semantic tokens only.
