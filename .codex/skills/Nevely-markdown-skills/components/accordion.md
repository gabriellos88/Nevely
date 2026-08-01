# Accordion — TypeUI · Astra

> **TypeUI · Astra** — stacked expand/collapse panels.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `typography.md`

An accordion folds long content — FAQs, settings sections, help — into scannable rows. In Astra it comes in three builds (grouped, separated cards, flush), but the silhouette is constant: **rounded** (`radius-xxl`, 24px) on the outer shell, **no perimeter border**, hairline `default` dividers between items (functional row separators), and a chevron that rotates 180° as a panel opens. Triggers stay quiet (`body` closed, `heading` on a soft fill when open); only the brand-emphasis variant raises the volume. Depth is flat throughout — separation comes from a lighter card surface and the row dividers, never a shadow.

---

## Anatomy

| Part | Role |
|---|---|
| **Root** | Optional outer frame that groups items (variant-dependent) |
| **Item** | One trigger + one panel pair |
| **Trigger** | Full-width control row — label, optional leading icon, trailing indicator |
| **Indicator** | Chevron or custom icon at the inline end; signals expand/collapse |
| **Panel** | Collapsible content region below its trigger |
| **Content** | Inner padding wrapper for body copy, lists, and nested accordions |

---

## Layout

### Trigger row

| Property | Value |
|---|---|
| Width | 100% of parent |
| Direction | Horizontal — label cluster at start, indicator at end |
| Alignment | Center vertically, space between start and end |
| Gap (label ↔ indicator) | 12px |
| Padding | 20px all sides |
| Min touch height | 44px total row height (padding + line box) |

### Panel content

| Property | Value |
|---|---|
| Padding | 20px all sides; 16px on narrow viewports |
| Paragraph spacing | 8px below each paragraph except the last |
| List inset | 20px from inline start; disc markers for unordered lists |

### Leading icon (optional)

| Property | Value |
|---|---|
| Size | 20 × 20px |
| Gap to label | 8px |
| Color | Inherits trigger text color |
| Position | Inline before label text, vertically centered with label |

---

## Typography

| Element | Size | Weight | Color token |
|---|---|---|---|
| Trigger label | font-size-sm | font-weight-medium | See states below |
| Panel body | font-size-sm | font-weight-normal | `body` |
| Panel links | font-size-sm | font-weight-normal | `fg-brand` |
| Panel link (hover) | font-size-sm | font-weight-normal | `fg-brand` + underline |
| List items in panel | font-size-sm | font-weight-normal | `body` |

Panel body line height is **line-height-body** (1.5 → 21px at 14px).

A trigger label stays **single line** where possible; let it wrap when the string is long — never ellipsis-truncate an FAQ trigger.

---

## Color & surface

All values reference semantic tokens from `colors.md` — never raw hex or palette steps.

### Trigger — default emphasis

| State | Text | Background |
|---|---|---|
| Closed | `body` | Transparent (shows root or page surface) |
| Open | `heading` | `neutral-secondary-medium` |
| Hover | `heading` | `neutral-secondary-medium` |
| Focus | Same as hover/open | Same as hover/open + focus ring (below) |
| Disabled | `fg-disabled` | Unchanged; no hover/open shift |

### Trigger — brand emphasis (color variant)

| State | Text | Background |
|---|---|---|
| Closed | `body` | Transparent |
| Open | `fg-brand` | `brand-softer` |
| Hover | `fg-brand` | `brand-softer` |
| Focus | Same as hover/open | Same as hover/open + focus ring |
| Disabled | `fg-disabled` | Unchanged |

### Panel

| Property | Token |
|---|---|
| Background | `neutral-primary` (or transparent in flush variant) |
| Body text | `body` |
| Top edge | 1px `default` border separating panel from trigger above |

### Focus ring

| Property | Value |
|---|---|
| Width | 2px |
| Color | `brand-subtle` or `brand-light` |
| Offset | 0–2px outside trigger box |
| Shape | Follows trigger corner radius |

---

## Border & radius

The rounded (24px) corner lives on the outermost shell; interior items square off so the rounding reads only at the edges of the group.

### Variant: grouped (default)

| Element | Border | Radius |
|---|---|---|
| Root | None — lighter card surface defines the group | `radius-xxl` (24px) on outer corners |
| Root overflow | Clip children to root radius | — |
| Item separator | 1px `default` bottom border on each item except the last | — |
| First item trigger | No top border (root provides it) | Top corners match root (`radius-xxl`) |
| Last item panel | No bottom border when closed; when open, bottom corners match root | Bottom corners `radius-xxl` when last and expanded |
| Middle items | Top/side borders removed — only bottom divider | Square corners on trigger |

### Variant: separated cards

| Element | Border | Radius | Shadow |
|---|---|---|---|
| Each item (closed) | None — lighter card surface over the section | `radius-xxl` all corners | None (`elevation-none`) |
| Item gap | — | — | 16px vertical space between items |
| Trigger when open | None; bottom edge open to panel | Top corners `radius-xxl`; **bottom corners square** | None |
| Panel when open | None; top edge shared with trigger | Bottom corners `radius-xxl` | None (`elevation-none`) |

### Variant: flush

| Element | Border | Radius | Background |
|---|---|---|---|
| Root | None | None | Transparent |
| Item separator | 1px `default` bottom border only | None | Transparent triggers and panels |
| Trigger padding | 20px vertical; horizontal aligns with parent content | — | Transparent |

---

## Shadow

| Variant | Shadow token | Where |
|---|---|---|
| Grouped (default) | `elevation-none` | Root wrapper only |
| Separated cards | `elevation-none` | Each closed card; open panel block (not on open trigger) |
| Flush | None | — |

---

## Indicator (chevron)

| Property | Value |
|---|---|
| Default icon | Chevron pointing down (stroke style) |
| Size | 20 × 20px |
| Color | Inherits trigger text color |
| Closed rotation | 0° (points down) |
| Open rotation | 180° (points up) |
| Transition | 150ms ease on rotation |
| Shrink | Indicator never compresses — fixed 20px box |

### Indicator alternatives

| Style | Behavior |
|---|---|
| **No indicator** | Trigger label only; panel state shown by background/border change |
| **Static icon** | Custom 20 × 20px icon at inline end — **no rotation** on open |
| **Replace chevron** | Any 20 × 20px icon at inline end; rotation optional per design intent |

One trailing indicator per trigger — never stack a chevron and a second icon at the same edge.

---

## Motion

| Transition | Duration | Properties |
|---|---|---|
| Trigger colors | 150ms | Text color, background color |
| Chevron rotation | 150ms | Transform rotate |
| Panel reveal | 150–200ms | Height / opacity (implementation-specific; visually smooth, not abrupt) |

Respect reduced-motion: instant state change or opacity-only fade — no forced rotation.

---

## Variants summary

| Variant | Outer frame | Item separation | Trigger hover (default) | Best for |
|---|---|---|---|---|
| **Grouped** | Single borderless, rounded, flat shell | Shared dividers | `neutral-secondary-medium` + `heading` text | FAQ blocks, settings sections |
| **Separated cards** | None — independent cards | 16px gap | Same as grouped | Scannable lists, spaced FAQ |
| **Flush** | None | Bottom borders only | Background shift optional; flush uses text-only dividers | Inside cards, sidebars, dense layouts |
| **Brand emphasis** | Same shell as grouped or separated | Same | `brand-softer` + `fg-brand` text | Marketing FAQ, featured help |

Open-behavior (one panel vs many) doesn't change visual tokens — only which items carry the open styling at once.

---

## Nested accordion

When an accordion lives inside another panel:

| Property | Value |
|---|---|
| Spacing above nested root | 16px below preceding panel paragraph |
| Nested root | Full grouped variant spec — borderless, `radius-xxl`, flat (`elevation-none`) |
| Nested trigger background | May use `neutral-primary-soft` on individual items for depth |
| Nesting depth | Visual tokens stay identical; avoid more than **two** visible border shells deep |

A nested accordion sits inside the content padding, never flush to the parent panel's edges.

---

## Content inside panels

| Element | Spec |
|---|---|
| Paragraphs | `body` color; 8px margin below between paragraphs |
| Links | `fg-brand`; underline on hover only |
| Unordered lists | `body` color; 20px inline-start padding; disc markers |
| Nested accordion | See nested section above |

Don't drop primary buttons into a panel without their own button spec — if used, follow button spacing (16px above the first button).

---

## States reference

| State | Grouped / separated trigger | Flush trigger |
|---|---|---|
| Closed | `body` text; transparent or `neutral-secondary-soft` if flush active styling | `body` text |
| Open | `heading` text; `neutral-secondary-medium` background | `heading` text; optional `neutral-primary` background |
| Hover | `heading` text; `neutral-secondary-medium` | `heading` text |
| Focus | Open/hover colors + 2px brand focus ring | Same |
| Disabled | `fg-disabled`; no background shift; no pointer affordance | Same |

---

## Prohibited

- **No outer shell below `radius-xxl`** — the rounded (24px) frame is the signature; interior items square off, they don't shrink the corner.
- **No mixed variants in one root** — don't combine a grouped shell with separated-card item styling.
- **No indicator larger than 20px or smaller than 16px** — chevron readability breaks at the extremes.
- **No status colors** (`success`, `danger`, `warning`) on triggers unless the accordion communicates live system state — never decoration.
- **No shadow on the flush variant** — flush is flat by definition.
- **No removing the panel top border** in grouped/separated variants — the trigger↔panel edge stays visible.
- **No centered trigger labels** in LTR — label at start, indicator at end (mirror for RTL).
- **No all-caps trigger labels** — sentence or title case per the type system.
- **No raw hex or palette steps**, and no one-off border widths — dividers are 1px `default` unless a variant table says otherwise.
