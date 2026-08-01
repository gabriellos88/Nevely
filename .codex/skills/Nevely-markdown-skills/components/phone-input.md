# Phone Input — TypeUI · Astra

> **TypeUI · Astra** — telephone entry: country code, verification codes, and auth flows.
> Depends on: `input-field.md`, `select.md`, `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`

A phone input is the Astra **field shell** typed for `tel`. When a country selector is attached, the selector and number field **fuse into one rounded (`radius-xxl`, 24px) control** — one shared `default`-bordered, flat (`elevation-none`) shell, square inner edge — exactly like an input group. Verification (OTP) reuses the per-cell box pattern from `number-input.md`. Country flags always carry a text alternative, and OTP digits always use visible per-cell inputs.

---

## Anatomy

| Part | Role |
|---|---|
| **Label** | Field or group label |
| **Country selector** | Dropdown or `<select>` for dial code |
| **Number control** | `type="tel"` text field |
| **Verification cells** | OTP / SMS code digit boxes |
| **Helper text** | Format hint or carrier note |

---

## Core layout

| Property | Token / value |
|---|---|
| Simple tel field | Full `input-field.md` shell |
| Country + number row | Horizontal flex; full width |
| Country segment width | Auto — fits flag + code; min ~100px |
| Gap (country ↔ number) | Fused group — no gap; shared `radius-xxl`, `elevation-none` |
| Country select shell | Same border/background as field; trailing chevron 16px |
| Number field | Flex-grow; flushes on shared inner edge |

---

## Variants

### Default phone input

A single full-width tel input; the placeholder shows the expected format, with an optional `pattern` for a validation hint.

### Phone input with country code

A leading country `<select>` or custom dropdown (`select.md` / `dropdowns.md`) fused to the tel field. The country block shows an optional 16 × 16px flag and the dial code in `font-size-sm` `heading`.

### Floating label input

The label animates from the placeholder position to the top on focus/fill (`font-size-sm`, `body` when floating); the field shell is unchanged. Transition ≤ 200ms.

### Verification code input

A row of 4–6 single-digit fields (the PIN pattern from `number-input.md`): ~40px wide, centered, `spacing-2` gap, **`radius-xxl`**, 4px `brand-medium` focus ring.

### Phone number select

The country is chosen from a select above or beside the number field; when not fused, stack them with `spacing-2` between.

### Authentication form

A composite: the phone field plus a "Send code" primary button (`buttons.md`), with `spacing-4` between the field group and the button.

### Advanced phone verification

A two-step layout — phone entry, then an OTP block revealed after submit (section gap `spacing-6`). Success/error messaging follows `input-field.md` validation.

---

## States

Focus, disabled, and validation inherit from `input-field.md`. The country selector's disabled state matches the select disabled treatment (`fg-disabled`, muted border).

---

## Motion

Floating label ≤ 200ms ease on transform/size. OTP auto-advance is behavioral — no decorative animation.

---

## Accessibility

| Requirement | Implementation |
|---|---|
| Label | "Phone number" or a grouped legend |
| Country | Selector has an accessible name ("Country code") |
| Autocomplete | `autocomplete="tel"` / `tel-country-code` as appropriate |
| OTP | `inputmode="numeric"`, group label "Verification code" |
| Error | Describe the format failure in text — not color alone |

---

## Prohibited

- **No country flags without a text alternative** — include the country name in the option.
- **No fused group with mismatched heights** — align block padding across segments so the rounded shell reads as one control.
- **No OTP collapsed into one invisible field** — use visible per-cell inputs unless following a proven accessible pattern.
