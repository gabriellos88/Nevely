# Toggle — TypeUI · Astra

> **TypeUI · Astra** — the binary on/off switch.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`

The toggle is one of Astra's functionally round controls: a **fully round (`radius-full`) track** carrying a circular thumb that slides from `neutral-quaternary` (off) to `brand` (on). It commits a setting immediately — no save step — and it is a true boolean, never a third radio-style state. Under the hood it's a visually hidden checkbox driving the track, so it stays keyboard-operable with a `brand-soft` focus ring.

---

## Anatomy

| Part | Role |
|---|---|
| **Native input** | Visually hidden checkbox (`sr-only`) |
| **Track** | Pill-shaped background |
| **Thumb** | Circular knob sliding inline |
| **Label** | Text beside track |
| **Dual labels** | Off/on text flanking track |
| **Icons** | Optional symbols inside track |

---

## Default toggle

| Property | Token / value |
|---|---|
| Track width | 36px |
| Track height | 20px |
| Track radius | `radius-full` |
| Track off | `neutral-tertiary` (`#1A0F33`, contrasting) with a `default` (`#281C40`) border |
| Track on | `brand` fill, `brand` border |
| Thumb size | 16 × 16px — **track height (20px) − 4px**, leaving a **2px gap above and below** the thumb; the thumb is always smaller than the track and never fills or overflows it |
| Thumb color | `default-strong` (off, visible on the light track); `white` (on) |
| Thumb radius | `radius-full` |
| Thumb inset (off) | 2px from inline start, vertically centered |
| Thumb travel (on) | Offset = **track width − thumb width − 2px** (default: 36 − 16 − 2 = **18px** from the inline-start), leaving a **2px gap** to the inline-end edge — the same gap as the off side. **Never `translateX(100%)`, never flush, never past the edge** |
| Focus ring | 4px `brand-soft` on track when input focused |
| Label gap | `spacing-3` from track |
| Label type | `font-size-sm`, `font-weight-medium`, `heading` |
| Row cursor | Pointer on label wrapper |

Thumb position transitions ≤ 200ms ease; track color ≤ 150ms.

**Thumb fit — must follow exactly.** The thumb sits **fully inside the track with a uniform 2px gap on all four sides** (top, bottom, leading, trailing) in **both** the off and on states. Its diameter is the **track height − 4px**, so it is always smaller than the track — it must **never** be as tall as the track, touch any edge, sit flush, or overflow. Off = 2px from the inline-start edge; on = 2px from the inline-end edge (offset = `track width − thumb width − 2px`).

**Thumb implementation — avoid these common breakages (they are what make the thumb look cut off or oversized):**

1. **Translate distance ≠ final offset.** The on-state *final position* is `track width − thumb width − 2px` from the start (default **18px**). But when you move the thumb from its off position (already 2px from the start) with `transform: translateX(…)`, the translate **distance** is `track width − thumb width − (2 × 2px inset)` = default **`36 − 16 − 4 = 16px`** → use **`translateX(16px)`**. **Do not** pass the 18px *final offset* as the translate value — translating an already-inset thumb by 18px pushes it flush/past the edge so it looks cut off.
2. **Never clip the thumb.** The toggle and **every ancestor** wrapping it must not use `overflow: hidden` around the thumb. In particular, **a table cell (`td`) that holds a toggle must use `overflow: visible`** — `overflow: hidden` on the cell chops the thumb.
3. **Track sizing.** Give the track **`box-sizing: content-box`** (or otherwise make its **interior** exactly the spec size — default **36 × 20px**) so the 16px thumb fits with a 2px gap on all four sides. With `border-box` + a border, the interior shrinks and the travel/gaps break.

---

## Variants

### Toggle example (default)

A single label after the track ("Toggle me").

### Checked state

Same visuals — the `checked` attribute defaults the thumb to the on position and the track to `brand`.

### Disabled state

Reduced-contrast track, `fg-disabled` label, no pointer events, frozen thumb.

### Double labels

An off label at the inline start, the track in the center, an on label at the inline end — `spacing-3` gaps. The active side may use `heading`, the inactive `body-subtle`.

### Toggle with icons

Check and X icons inside the track at 12 × 12px; the thumb covers the active icon as it slides. Icons are `body` when visible past the thumb.

### Toggle card

A bordered settings row: padding `spacing-4`, `default-medium` border, **`radius-xxl`**, flex space-between — copy block at the start, toggle at the inline end. Title `font-weight-medium`; description `body-subtle`. (The card is a rounded shell; the switch track stays `radius-full`.)

### Toggle card with icon

A 20 × 20px leading icon in the copy block; the toggle centers on the trailing edge.

### Colors

| Intent | Track on |
|---|---|
| Brand (default) | `brand` |
| Success | `success` |
| Danger | `danger` |
| Warning | `warning` |
| Purple / secondary brand | product token if defined in `colors.md` |

The off state stays `neutral-quaternary` for every intent.

### Sizes

| Size | Track (W × H) | Thumb |
|---|---|---|
| Small | 32 × 18px | 14 × 14px |
| Default | 36 × 20px | 16 × 16px |
| Large | 44 × 24px | 20 × 20px |

Adjust the thumb inset proportionally (2px).

---

## States

| State | Track | Thumb |
|---|---|---|
| Off | `neutral-quaternary` | Inline start |
| On | Intent fill (default `brand`) | Inline end |
| Focus | 4px `brand-soft` ring | — |
| Disabled | Muted quaternary | No slide on interaction |
| Hover (enabled) | Optional slight track darkening — subtle only |

---

## Motion

Thumb slide 150–200ms standard easing. Under `prefers-reduced-motion`, snap without the slide.

---

## Accessibility

| Requirement | Implementation |
|---|---|
| Role | Native checkbox semantics — don't use `role="switch"` unless implementing switch ARIA fully |
| Label | Wrapping `<label>` or `aria-labelledby` |
| State | `checked` reflects on/off; the visible state matches |
| Focus | Focus ring on keyboard focus — the hidden input receives focus |
| Dual labels | Still one accessible name summarizing the setting |

---

## Prohibited

- **No square track** — the toggle is always `radius-full`. This is the signature, not a preference.
- **No toggle without a label** for settings that need context.
- **No thumb smaller than 14px** on the default track without a size variant.
- **No instant state without a keyboard path** — it must respond to Space on the focused input.
- **No radio-group semantics** — one toggle equals one boolean.
- **No thumb flush against the track edge** — in the **on** state the thumb stops **2px short of the inline-end edge**, keeping the same 2px gap it has on the off side; it must never touch, sit flush to, or overflow the track edge.
- **No thumb that fills or overflows the track** — the thumb is always **smaller than the track** (diameter = track height − 4px) and keeps a **uniform 2px gap on all four sides** (top, bottom, leading, trailing) in both states; it must never be as tall as the track, bulge past it, or sit edge-to-edge.
