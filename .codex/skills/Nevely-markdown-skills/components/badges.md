# Badges — TypeUI · Astra

> **TypeUI · Astra** — compact labels, counts, status chips, and notification dots.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`

In Astra a badge is **always a pill** (`radius-full`) — that fully rounded silhouette is part of the theme's signature, like every other shell. Badges are small, flat (`elevation-none`), and soft-filled; they annotate rather than act — counts on buttons, status on rows, filter chips, metadata. Color carries intent (brand for emphasis, success/danger/warning for real state), but never *only* color: a badge always also says or shows what it means. A badge is never a primary call to action — that is a button's job. (The only round badge elements are genuinely circular ones — the status dot and an avatar chip's image.)

---

## Anatomy

| Part | Role |
|---|---|
| **Root** | Inline pill chip |
| **Label** | Short text (1–3 words or numeric count) |
| **Leading icon** | Optional 12px glyph |
| **Status dot** | Optional filled circle before label |
| **Dismiss control** | Optional × on chip variants |
| **Avatar** | Optional circular image on chip variants |

---

## Sizes

Two text sizes plus icon-only boxes — and every one is a pill.

| Size | Type | Padding | Radius |
|---|---|---|---|
| **Small (default)** | Text | `spacing-1-5` horizontal, `spacing-0-5` vertical | `radius-full` (pill — always) |
| **Large** | Text | `spacing-2` horizontal, `spacing-1` vertical | `radius-full` (pill — always) |
| **Icon-only small** | Square | — | 20 × 20px box, `radius-full` |
| **Icon-only large** | Square | — | 24 × 24px box, `radius-full` |

| Size | Font | Weight | Line height |
|---|---|---|---|
| Small | font-size-xs | font-weight-medium | line-height-component |
| Large | font-size-sm | font-weight-medium | line-height-component |

---

## Intents

Soft fill, intent foreground — calm by default, with the bordered column for surfaces that need a defined edge.

| Intent | Background | Foreground | Border (bordered) |
|---|---|---|---|
| **Brand** | `brand-softer` | `fg-brand-strong` | `brand-subtle` |
| **Alternative** | `neutral-primary-soft` | `heading` | `default` |
| **Neutral** | `neutral-secondary-medium` | `heading` | `default-medium` |
| **Danger** | `danger-soft` | `fg-danger-strong` | `danger-subtle` |
| **Success** | `success-soft` | `fg-success-strong` | `success-subtle` |
| **Warning** | `warning-soft` | `fg-warning` | `warning-subtle` |

For interactive (link/chip) badges, hover steps the fill one level — `brand-soft`, `neutral-tertiary-medium`, `danger-medium`, etc. per intent.

---

## Variants

Every variant below is a pill — the differences are fill, border, and contents, never the corner.

### Default

Soft fill, no border. Inline-flex, width fits content.

### Bordered

A 1px intent border on the full perimeter; same padding and type as default.

### Pill shape (always on)

Every badge in Astra is a **pill** — `radius-full` on the root in all sizes and variants (default, bordered, link, icon, dismissible, count). There is no square or hard-cornered badge in this theme; only the inner status dot and avatar image are circular.

### Large bordered (inset ring)

Large size with a 1px inset ring in the intent border color (`brand-subtle`, etc.) on the pill `radius-full` shell — reads like bordered without doubling the outer edge.

### As link

The bordered badge on an anchor; the fill shifts on hover per intent.

### With icon

A leading icon — 12px (small) or 14px (large); gap `spacing-1` (small) or `spacing-1-5` (large).

### Icon-only

A fixed circle/pill box with a centered icon and no label — so an `aria-label` describing its meaning is required.

### With dot

An 8px filled circle before the label (gap `spacing-1-5`) in the intent foreground color — for live status.

### With loader

Swap the leading icon for a 12px spinning stroke; the badge keeps its size — for an in-progress chip.

### Dismissible chip

An inline-flex row of label + 16px dismiss (20px hit target; hover `neutral-tertiary-medium`) — for active filters and selected tags.

### Chip with avatar

A 24px circular avatar at the inline start (gap `spacing-2`), with padding tuned so the avatar aligns to the chip's cap height.

### Notification count (overlay)

A mini badge pinned to a parent corner (button, icon, avatar):

| Property | Value |
|---|---|
| Min box | 18 × 18px |
| Font | font-size-xs, font-weight-medium |
| Fill | `danger-soft` or intent soft |
| Text | `fg-danger-strong` |
| Border | 1px matching soft fill |
| Radius | `radius-xxl` (pill) |
| Position | Top-trailing corner of parent, slight negative inset |

### Button-attached count

A pill count inside a button's label area: ~18px box, `brand-soft` fill, `fg-brand-strong` text, `spacing-2` gap after the label.

---

## Shadow

Badges are flat — **`elevation-none`**. Their depth comes from color and border, never shadow.

---

## Motion

| Transition | Duration | Properties |
|---|---|---|
| Hover background | 150ms | Background color |
| Dismiss remove | 150ms | Opacity (optional) |
| Loader spin | continuous | Transform rotate |

---

## Accessibility

- Icon-only and dot-only badges need an **`aria-label`** or adjacent visible text.
- Notification counts surface the total in the parent's accessible name (e.g. "Messages, 2 unread").
- Dismissible chips give the dismiss control `aria-label="Remove {label}"`.
- Never encode meaning by color alone — a label or icon is always present.

---

## Prohibited

- **No rounded badges** — every badge is pill (`radius-full`); never `radius-md`, `radius-full`, or pill corners. This is the signature, not a preference. (The inner status dot and avatar image stay circular.)
- **No raw hex, px, or rem** except fixed icon box sizes — spacing and colors use tokens.
- **No shadow on badges** — `elevation-none`.
- **No paragraph-length badge text** — truncate or use a tooltip; badges are labels.
- **No badge as a sole primary CTA** — pair it with a button or link when action is required.
- **No mixing intents** in one badge.
- **No font-size above `font-size-sm`** — badges stay compact.
- **No framework or vendor class names** in specs.
