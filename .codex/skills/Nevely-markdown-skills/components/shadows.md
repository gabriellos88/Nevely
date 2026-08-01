# Elevation & Shadow Tokens — TypeUI · Astra

> The depth system for **TypeUI · Astra**. On Astra's dark surface, depth is communicated by a **raised, slightly-lighter panel** plus a **subtle `default` (`#281C40`) border** — not by heavy drop shadows. Cards sit on `neutral-primary` (`#0A0118`), a step lighter than the `#000000` page, and read as lifted; floating overlays add a backdrop scrim and may carry an optional soft brand glow. The elevation tokens below are retained as the system’s depth vocabulary, but every level resolves to **`none`** in this theme; they are the single source of truth — components reference them, never one-off shadow values. **One documented exception:** floating overlays — dropdowns, popovers, and menus — lift off the page and therefore carry a real **medium drop shadow** (`elevation-2`) over their bordered panel; resting cards and sections stay flat (see `dropdowns.md`).

Depends on: `colors.md` (separation comes from a raised surface tone and the border token, not shadow color).

---

## Token naming

| Pattern | Role |
|---|---|
| `elevation-none` | Flat — no shadow |
| `elevation-{1–5}` | Depth level by intent; all resolve to `none` **except `elevation-2`, the floating-overlay medium shadow** — resting separation is handled by surface color and border |

Each level is a single token — do not split or hand-roll shadow layers in component code.

---

## Shadow anatomy

| Property | Meaning |
|---|---|
| Offset X | Horizontal displacement (+ right, − left) |
| Offset Y | Vertical displacement (+ down, − up) |
| Blur | Softness of the shadow edge |
| Spread | Expansion (+) or contraction (−) of the shadow shape |
| Color | RGBA — opacity controls perceived elevation |

Astra does not paint shadows; this anatomy is retained only so a documented exception (if ever added) describes its layers consistently.

---

## Elevation scale

| Token | Shadow value |
|---|---|
| elevation-none | `none` |
| elevation-1 | `none` |
| elevation-2 | `0px 8px 24px rgba(0, 0, 0, 0.45)` |
| elevation-3 | `none` |
| elevation-4 | `none` |
| elevation-5 | `none` |

---

## Flat registry

```
elevation-none   none
elevation-1      none
elevation-2      0px 8px 24px rgba(0, 0, 0, 0.45)
elevation-3      none
elevation-4      none
elevation-5      none
```

---

## Usage by surface type

| Surface | Token | Rationale |
|---|---|---|
| Resting cards, accordions (grouped) | `elevation-none` | Separation comes from the lighter card surface, not shadow |
| Separated cards, hover lift | `elevation-none` | Boundary read from surface tone and spacing |
| Dropdowns, popovers, menus | `elevation-2` | A real **medium** drop shadow — the floating-overlay exception; lifts the bordered panel off the section |
| Modals, drawers (sheet) | `elevation-none` | Separation from a backdrop scrim, not a drop shadow |
| Floating action, critical overlay | `elevation-none` | Emphasis through surface and placement |
| Flat lists, flush accordions, inline fields | `elevation-none` | No depth signal |

---

## Principles

- **Hierarchy** — closeness to the viewer is signalled by the `default` border, spacing, and scrims — never by a drop shadow.
- **Emphasis** — to prioritize a surface, give it a stronger border (e.g. `brand`) or add a scrim behind it; do not lift its fill and do not reach for shadow.
- **Restraint** — the whole system is flat; if a screen looks like it needs a shadow to separate two surfaces, use the `default` border instead.

---

## Prohibited

- **No raw box-shadow strings in components** — use an `elevation-*` token (all resolve to `none`).
- **No drop shadows on cards or components** — Astra is flat; separation is by surface color and scrims.
- **No colored shadows** unless a dedicated token is added to this file with documented intent.
- **No reintroducing shadow depth** to “lift” a floating element — use a lighter panel surface and a backdrop scrim.
- **No drop shadow to fake depth** — cards and shells separate with the `default` (`#281C40`) border and surface color, not with elevation.
- **No foreign elevation naming** — map into these tokens in your implementation layer; do not rename and call that the design system.
</content>
