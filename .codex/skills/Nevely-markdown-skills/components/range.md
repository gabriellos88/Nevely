# Range — TypeUI · Astra

> **TypeUI · Astra** — horizontal slider input.
> Depends on: `colors.md`, `radius.md`, `spacing.md`, `typography.md`

The range is one of Astra's naturally round controls: a fully pill (`radius-full`) `neutral-quaternary` track carrying a circular `brand` thumb, with the same **`brand-medium` focus ring** the rest of the system uses. It stays calm and monochrome — neutral track, brand thumb and fill — and horizontal only. The thumb always shows a visible focus indicator; the track never goes rainbow.

---

## Anatomy

| Part | Role |
|---|---|
| **Label** | Field name above slider |
| **Track** | Full-width horizontal bar |
| **Fill (optional)** | Portion from min to thumb — product styling |
| **Thumb** | Draggable handle |
| **Tick labels** | Optional values below track |

---

## Track (default)

| Property | Token / value |
|---|---|
| Width | 100% of parent |
| Height | 8px |
| Background | `neutral-quaternary` |
| Radius | `radius-full` |
| Appearance | Native browser chrome reset — custom track fills height |
| Cursor | Pointer on track and thumb |

---

## Thumb

| Property | Token / value |
|---|---|
| Size | ~16 × 16px circle (browser-dependent — target this) |
| Background | `brand` |
| Border | 2px `white` or `buffer` optional for contrast |
| Radius | `radius-full` |
| Focus ring | 4px `brand-medium` when input focused |

The filled portion left of the thumb (where supported): `brand` at track height, `radius-full`.

---

## Label typography

| Element | Size | Weight | Color | Spacing |
|---|---|---|---|---|
| Label | `font-size-sm` | `font-weight-medium` | `heading` | `spacing-2-5` below label |

---

## Variants

### Range slider example (default)

`min="1"` `max="100"` `value="50"` — label optional.

### Disabled state

Track `neutral-quaternary` at reduced opacity; thumb muted; `fg-disabled` label; no interaction.

### Min and max

Behavioral attributes only — the label may restate the bounds in helper text.

### Steps

The `step` attribute controls the increment and the thumb snaps per step — no extra visual ticks unless the labels variant adds them.

### Sizes

| Size | Track height | Notes |
|---|---|---|
| Small | 4px | Class equivalent `range-sm` |
| Default | 8px | — |
| Large | 12px | Class equivalent `range-lg` |

The thumb scales proportionally (~14px / 16px / 20px).

### Labels

A relative container with the track and absolutely positioned labels below:

| Property | Token / value |
|---|---|
| Label row offset | `spacing-6` below track center |
| Label text | `font-size-sm`, `body` |
| Positions | Inline start, thirds, inline end mapped to min/mid/max values |
| Transform | Center-align middle labels with translate on the inline axis |

Example milestones: "Min ($100)", "$500", "$1000", "Max ($1500)".

---

## States

| State | Visual |
|---|---|
| Default | Track quaternary, thumb brand |
| Hover | Optional thumb scale ≤ 105% — subtle |
| Focus | 4px `brand-medium` ring on input |
| Disabled | Muted track and thumb |
| Active drag | Thumb stays brand; no shadow elevation needed |

Pairing with a number field: see `number-input.md` — value sync is behavioral.

---

## Motion

The thumb tracks the pointer with no intentional lag; the focus ring is instant; an optional hover scale runs ≤ 100ms. Under `prefers-reduced-motion`, disable the hover scale only.

---

## Accessibility

| Requirement | Implementation |
|---|---|
| Label | `<label for>` or `aria-label` |
| Value | `aria-valuemin`, `aria-valuemax`, `aria-valuenow` when not native |
| Keyboard | Arrow keys adjust the value |
| Output | Optional live `output` element linked via `for` / `aria-labelledby` |
| Labels variant | Text labels supplement — never the sole value indicator |

---

## Prohibited

- **No vertical range in this spec** — horizontal only unless a layout spec adds the variant.
- **No track height below 4px** — it fails touch usability.
- **No thumb without a visible focus indicator**.
- **No rainbow track fills** — neutral track, brand thumb/fill only, unless an intent variant is documented.
- **No milestone labels without corresponding logical values**.
