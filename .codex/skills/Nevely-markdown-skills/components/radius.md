# Border Radius Tokens — TypeUI · Astra

> Corner-radius tokens for the **TypeUI “Astra”** design system. Astra is a soft, modern theme: its most recognizable traits are **pill-shaped interactive controls** (buttons, inputs, search, badges land on `radius-full`) and **generously rounded panels** (cards and modals at 24px). Every value below is a literal size — tokens are the source of truth; components reference tokens, never ad-hoc px or rem.

Depends on: none (pairs with `colors.md` for nested-radius math on filled surfaces).

**Root assumption:** `1rem = 16px` unless the product documents a different root.

---

## Astra radius convention (read first)

This is the rule that defines the Astra look. Do not deviate without a documented exception.

| Rule | Token | Value | Applies to |
|---|---|---|---|
| **Pill controls** | `radius-full` | 999px | Buttons, badges, chips, tags, pill tabs — fully rounded |
| **Rounded panels & fields = 24px** | `radius-xxl` | 24px | Cards, modals, drawers (free edges), dropdown & menu panels, alerts, accordions, tabs panels, tables, tooltips, popovers, and single-line field shells (inputs, selects, search/number/phone) |
| **Textarea (multi-line) = 16px max** | `radius-md` | 16px | The multi-line `textarea` — caps at 16px so a tall box doesn't bow, never the 24px shell |
| **Functionally round controls** | `radius-full` | 999px | The toggle track, avatars, radio control, range thumb & track, status dots, spinners |
| **Checkbox box** | `radius-none` | 0 | The 16px tick box — **always square**, never rounded |
| **Nested child inside a panel** | `radius-md` | 16px | Menu items, inset cells inside a padded 24px parent (see Nested radius) |
| **Flush data** | `radius-none` | 0 | Table cells, flush list rows, dividers |

Buttons and badges are **pill** (`radius-full`); panels and field inputs are **24px** (`radius-xxl`). This pairing is the Astra silhouette.

**Edge-anchored exception:** panels that sit flush against a viewport edge — drawers, full-bleed bottom sheets — keep **square** corners on the flush edges. Only their free, inward-facing corners take `radius-xxl` (24px).

---

## Token naming

| Pattern | Role |
|---|---|
| `radius-base` | Single base unit all steps derive from |
| `radius-{step}` | Named step on the scale (`none` → `full`) |

Steps are **multipliers of `radius-base`**, not independent picks.

---

## Base unit

| Token | rem | px |
|---|---|---|
| radius-base | 0.25rem | 4px |

---

## Radius scale

| Token | Multiplier | rem | px | Typical use |
|---|---|---|---|---|
| radius-none | 0 | 0 | 0 | Square corners, table cells, flush dividers |
| radius-xs | 2× | 0.5rem | 8px | Hairline inset frames, compact inner accents — **not** checkboxes |
| radius-sm | 3× | 0.75rem | 12px | Small inner controls, compact chips |
| radius-md | 4× | 1rem | 16px | Nested children inside a 24px panel (menu items, inset cells) |
| radius-lg | 5× | 1.25rem | 20px | Secondary panel surfaces |
| radius-xl | 6× | 1.5rem | 24px | Larger panel surfaces |
| radius-xxl | 6× | 1.5rem | 24px | **Astra panel default** — cards, modals, menus, alerts, tabs panels, tables, tooltips |
| radius-xxxl | 8× | 2rem | 32px | Oversized hero cards / large feature panels (opt-in, above the 24px default) |
| radius-full | 9999× | — | 9999px | **Pill controls** (buttons, inputs, badges) and functionally round controls (toggle, avatar, radio, range) |

Panels converge on 24px (`radius-xxl`); interactive controls and naturally round controls use `radius-full`.

---

## Flat registry

```
radius-base    0.25rem    (4px)
radius-none    0
radius-xs      0.5rem     (8px)
radius-sm      0.75rem    (12px)
radius-md      1rem       (16px)
radius-lg      1.25rem    (20px)
radius-xl      1.5rem     (24px)
radius-xxl     1.5rem     (24px)
radius-xxxl    2rem       (32px)
radius-full    9999px
```

---

## Nested radius

When a rounded parent wraps a rounded child with padding between them:

```
innerRadius = outerRadius − padding
```

Use the **px** values from the scale above. With a 24px panel and `spacing-4` (16px) padding, an inset child rounds to roughly `radius-md` (16px) so the inner corner stays concentric, not an exception to the 24px rule.

---

## Usage by surface type

| Surface | Token | px |
|---|---|---|
| **Pill controls** — buttons, badges, chips, pill tabs | `radius-full` | 999px |
| **Panels & field shells** — cards, modals, drawers (free edges), dropdown & menu panels, alerts, accordions, tabs panels, tables, tooltips, inputs, selects, search/number/phone | `radius-xxl` | 24px |
| **Textarea (multi-line)** — caps at 16px so the tall box reads as a clean rectangle | `radius-md` | 16px |
| **Functionally round controls** — toggle track, avatars, status dots, radio, range, spinners | `radius-full` | 999px |
| Checkbox tick box | `radius-none` | 0 |
| Nested children inside a 24px panel (menu items, inset cells) | `radius-md` | 16px |
| Oversized hero / feature panels (opt-in) | `radius-xxxl` | 32px |
| Flush lists, table cells, dividers | `radius-none` | 0 |

---

## Prohibited

- **No raw px/rem in components** — use a `radius-*` token.
- **No square buttons or badges** — they are `radius-full` (pill); shipping hard-cornered buttons is a different theme, not Astra.
- **No square panels** — cards, modals, and menus are `radius-xxl` (24px); do not ship 0px/4px panel corners.
- **No `radius-full` on large content panels** — full rounding is for pill controls and naturally round controls, not cards, modals, or page panels.
- **No off-scale values** (e.g. 6px, 10px, 18px) — add a token to this file if the scale is insufficient.
- **No copying the parent radius onto nested children** without subtracting padding (see nested radius) — items inside a 24px panel use `radius-md`.
- **No mixing step names from foreign systems** — if a token exists here, use its name.
- **No rounded checkboxes** — the tick box is always `radius-none` (square). Never `radius-full`, `radius-xs`, or any other radius on a checkbox control — round boxes are for radios and pills, not checkboxes.
