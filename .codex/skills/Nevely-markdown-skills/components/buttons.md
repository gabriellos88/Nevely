# Buttons — TypeUI · Astra

> **TypeUI · Astra** — the action layer of the system.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`, `badges.md`

In Astra, a button is a **solid violet pill** (`radius-full`) with a `white` label and a soft lift shadow — and on hover a **lighter shade of the same violet (`brand-medium`) blooms up from the bottom** while the `white` label holds. Buttons are confident but never loud: exactly one filled **brand** primary leads each section, and everything else steps back to secondary, tertiary, ghost, outline, or link. The vivid **violet brand** carries "the next step" and always pairs with a **`white` label**; the status fills (success, danger, warning) appear only when the action genuinely is that. The full bloom-up treatment is documented under **Signature interaction**.

---

## Anatomy

| Part | Role |
|---|---|
| **Root** | Button or link-styled control |
| **Label** | Text content |
| **Leading / trailing icon** | Optional 16px glyph |
| **Badge** | Optional count pill inside label (see `badges.md`) |
| **Loader** | Optional spinner replacing icon or prefixing label |

---

## Sizes

**Dashboard rule — small buttons by default.** In dashboard, application, and product-UI layouts, buttons use the **Small** size — never the **Base** (or larger) default. Reserve Base and larger for marketing, landing, and editorial pages.

Five tiers, all sharing the same soft shell. `font-size-sm` base keeps buttons compact and businesslike; reach for Large/Extra large only on marketing CTAs.

| Size | Font | Padding (inline × block) | Icon |
|---|---|---|---|
| Extra small | font-size-xs | `spacing-3` × `spacing-1-5` | 14px |
| Small | font-size-sm | `spacing-3` × `spacing-2` | 16px |
| Base (default) | font-size-sm | `spacing-4` × `spacing-2-5` | 16px |
| Large | font-size-md | `spacing-5` × `spacing-3` | 16px |
| Extra large | font-size-md | `spacing-6` × `spacing-3-5` | 20px |

Shared shell, every size:

| Property | Value |
|---|---|
| Weight | font-weight-medium |
| Line height | line-height-component |
| Radius | `radius-full` (pill) — every size and variant |
| Surface depth | Soft lift shadow (`dark-backdrop`) at rest; a lighter `brand-medium` fill blooms up on hover, label stays `white` (see **Signature interaction**). |
| Gap label ↔ icon | `spacing-1-5` |
| Min touch target | 44px on mobile — pad to meet if label is short |

---

## Variants — filled

The workhorses. The **brand** primary wears the bloom-up treatment (see **Signature interaction**); the other intents are solid fills of their intent token with the same focus ring and the same hover bloom — the fill blooms to a *lighter step of that same intent* and the `white` label stays put. Status intents (success, danger, warning) bloom in their own lighter shade, not brand.

| Variant | Background | Text | Border | Hover background | Focus ring |
|---|---|---|---|---|---|
| **Primary (brand)** | `brand` | `white` | transparent | `brand-strong` | `brand-medium` |
| **Secondary** | `neutral-secondary-medium` | `body` | `default-medium` | `neutral-tertiary-medium` + `heading` text | `neutral-tertiary` |
| **Tertiary** | `neutral-primary-soft` | `body` | `default` | `neutral-secondary-medium` + `heading` text | `neutral-tertiary-soft` |
| **Success** | `success` | `white` | transparent | `success-strong` | `success-medium` |
| **Danger** | `danger` | `white` | transparent | `danger-strong` | `danger-medium` |
| **Warning** | `warning` | `white` | transparent | `warning-strong` | `warning-medium` |
| **Dark** | `dark` | `white` | transparent | `dark-strong` | `neutral-tertiary` |
| **Ghost** | transparent | `heading` | transparent | `neutral-secondary-medium` | `neutral-tertiary` |

Focus ring: a visible spread using the intent ring token; offset 0. This ring is how the system stays keyboard-first, so it is never removed.

---

## Variants — outline

The quieter sibling of filled: transparent or `neutral-primary` fill, a **2px** intent border, and an intent-foreground label. On hover the button "fills in" with its intent and the label flips to `white` (or, on light warning fills, a dark label for contrast).

**Outline border width is always 2px** — every outline variant carries a 2px border in its intent color (the `Border` column below names the color, the width is 2px). This is what gives the outline button its weight against the solid violet fill buttons.

| Variant | Border (2px) | Label | Hover fill |
|---|---|---|---|
| Brand | `brand` | `fg-brand` | `brand` (label → `white`) |
| Neutral | `default` | `body` | `neutral-secondary-soft` |
| Success | `success` | `success` | `success` |
| Danger | `danger` | `danger` | `danger` |
| Warning | `warning` | `warning` | `warning` |

Outline sizes mirror the filled size table exactly.

---

## Signature interaction — bloom-up fill

The defining button of Astra is a **solid violet pill that brightens on hover**. At rest it's a clean `brand` (`#713DFF`) pill with a `white` label and a soft lift shadow. On hover, a **lighter shade of the same violet — `brand-medium` (`#8B5CFF`) — blooms up from the bottom**, growing from a flat sliver into a full rounded shape that floods the control; the **label stays `white`** (the bloom is only a lighter tint of the same hue, so contrast holds) with a tiny scale-up pulse. It's a single, confident lighten — same color, brighter — rather than a glow. The rule is **stack-agnostic**: it names which token supplies each value, so it can be built with plain CSS, a CSS-in-JS layer, a utility framework, or any renderer.

**Token sourcing (never hard-coded):**

| Aspect | Source |
|---|---|
| Resting background | `brand` (`#713DFF`) — `colors.md` |
| Resting label | `white` |
| Resting shadow | soft lift in `dark-backdrop` (a low, wide shadow on the dark page) |
| Hover bloom fill | `brand-medium` (`#8B5CFF`) — the same violet, a step lighter; blooms up from the bottom to cover the control |
| Hover label | stays `white` (the lighter-violet bloom keeps it legible); subtle `scaleUp` pulse |
| Focus ring | `brand-medium` — `colors.md` |
| Corner radius | `radius-full` (pill) — `radius.md` |
| Padding / sizing | the **Sizes** table above (`spacing-*`) — `spacing.md` |
| Font family / weight / size | `font-family` (Inter V), `font-weight-bold`, size per tier — `typography.md` |
| Tracking | `letter-spacing-widest` — `typography.md` |
| Easing / duration | `ease-in-out`; ~0.4s bloom, ~0.3s label pulse (see **Motion**) |

**Status variants:** each intent button rests on its own fill (`success` / `danger` / `warning`) and blooms to a *lighter step of that same intent* (e.g. `success-strong` → `success`), the `white` label staying put — same motion, same hue, just brighter.

**Behavior:** at rest, a solid `brand` pill, `white` label, soft lift. On hover, the lighter-violet (`brand-medium`) fill grows from the bottom edge up and over the control while the label stays `white` and gives a subtle scale pulse. On focus, the `brand-medium` ring shows. Honor `prefers-reduced-motion` by swapping the bloom for an instant fill and dropping the pulse.

**Reference implementation** (illustrative only — every literal here must resolve to the tokens in the table above; sizes, radius, and font come from the foundation files):

```css
/* Bloom-up button — map every literal to an Astra token before shipping */
button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 0;
  border-radius: var(--radius-full);            /* pill */
  background: var(--brand);                      /* #713DFF */
  box-shadow: 0 6px 24px var(--dark-backdrop);   /* soft lift on the dark page */
  cursor: pointer;
  user-select: none;
}

/* the lighter-violet fill that blooms up from the bottom on hover */
button::after {
  content: "";
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  width: 100%;
  height: 0%;
  background: var(--brand-medium);               /* same violet, a step lighter */
  border-radius: 0;
  transform: scale(1);
  transition: all 0.4s ease-in-out;
}
button:hover::after {
  bottom: auto;
  top: 0;
  height: 100%;
  border-radius: 50%;
  transform: scale(1.5);
}

/* label rides above the bloom — stays white throughout */
button span {
  position: relative;
  z-index: 1;
  padding: var(--spacing-4) var(--spacing-6);    /* → spacing-* per size tier */
  color: var(--white);
  font-family: inherit;                          /* → font-family (Inter V) */
  font-size: 1.125rem;                           /* → font-size-* per size tier (lg shown) */
  font-weight: 700;                              /* → font-weight-bold */
  letter-spacing: var(--letter-spacing-widest);
}
button:hover span {
  animation: scaleUp 0.3s ease-in-out;           /* subtle pulse; label stays white */
}

@keyframes scaleUp {
  0%   { transform: scale(1); }
  50%  { transform: scale(0.95); }
  100% { transform: scale(1); }
}

button:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px var(--brand-medium);     /* the focus ring */
}
```

---

## Icon buttons

A square control — width equals height per tier — for toolbars and compact actions. Use any filled, outline, or ghost row above.

| Size | Box | Icon |
|---|---|---|
| Small | 36 × 36px | 16px |
| Base | 40 × 40px | 16px |
| Large | 44 × 44px | 20px |

There is no visible label, so an **`aria-label` is mandatory** — never ship a nameless icon button.

---

## Special patterns

### With badge

Primary label + a circular count pill (`spacing-2` gap) — see the button-attached count in `badges.md`.

### Loader

A 16px spinner sits at the label start; keep or hide the label, but mark the control `disabled` or `aria-busy="true"` while it runs so it cannot be double-submitted.

### Disabled

Drop to 50% opacity or `fg-disabled` text, remove hover and the focus ring, set `pointer-events: none`, and apply the native `disabled` attribute. A disabled button must never look clickable.

### Link as button

An anchor wearing button tokens — use it for navigation that should read as a primary action, and keep the keyboard focus ring intact.

### Provider / OAuth / payment

The one place third-party brand color is allowed: isolated provider variants (social login, wallet, card network). Document the provider hex *outside* the semantic tokens and never recycle it as a system intent.

### Gradient / colored shadow (optional marketing)

Not part of core Astra. Default product UI is solid fills only. If a campaign needs a gradient, define the paired tokens in `colors.md` and `shadows.md` first — do not hand-roll them on the button.

---

## Motion

Astra buttons fill on hover with a smooth `ease-in-out` wipe.

| Transition | Duration | Properties |
|---|---|---|
| Hover bloom | ~0.4s ease-in-out | lighter `brand-medium` fill grows from the bottom (`height` 0→100%, `border-radius` 0→50%, `scale` →1.5) |
| Hover label | ~0.3s ease-in-out | label stays `white` with a `scaleUp` pulse (1 → 0.95 → 1) |
| Focus | ~150ms | `brand-medium` ring |
| Loader | continuous | Spinner rotation |

Honor `prefers-reduced-motion`: swap the bloom for an instant fill and drop the `scaleUp` pulse.

---

## Accessibility

- Native `<button type="button|submit|reset">` for actions; `<a>` only when navigating.
- Icon-only controls carry a descriptive `aria-label`.
- Loading state uses `aria-busy="true"` and blocks duplicate submits.
- The 4px focus ring is always visible on keyboard focus — never remove the outline without an equivalent replacement.
- Truly inactive controls leave the tab order.

---

## Prohibited

- **No raw hex in core variants** — semantic tokens only (documented provider buttons are the sole exception).
- **No corners other than `radius-full`** (pill) — square or hard-cornered buttons are a different theme, not Astra.
- **No framework class names** in specs.
- **No arbitrary drop shadows** — the only resting shadow is the soft `dark-backdrop` lift; depth on interaction is the bloom fill, not extra shadows or glows.
- **No two primary brand buttons** side by side in one action group — Astra allows a single obvious next step.
- **No font-size above `font-size-md`** on standard buttons.
- **No ghost variant for a destructive confirm** — use danger filled or outline so the stakes read.
- **No off-token bloom** — the hover bloom is a *lighter step of the resting fill* (`brand-medium`, or the intent's lighter step) and the label stays `white`; never an off-token fill, white/`buffer` bloom, gradient, or rainbow blend.
