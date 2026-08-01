# File Input — TypeUI · Astra

> **TypeUI · Astra** — file upload: native picker, multi-file, and dropzones.
> Depends on: `input-field.md`, `buttons.md`, `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`

A native file picker wears the standard Astra **field shell** from `input-field.md`. When a screen invites drag-and-drop, it graduates to a **dropzone**: a roomy rounded (`radius-xxl`, 24px) target with a *dashed* `default-strong` border — the dashed edge is the system's signal for "drop here," and it's the one place Astra trades its solid border for a dashed one. Constraints (formats, size) always live in visible helper text, never hidden in a tooltip.

---

## Anatomy

| Part | Role |
|---|---|
| **Label** | Describes expected file type or purpose |
| **Native control** | Hidden or styled `<input type="file">` |
| **Dropzone surface** | Click/drag target replacing default file UI |
| **Icon** | Upload cloud or arrow — centered in dropzone |
| **Primary line** | "Click to upload" emphasis |
| **Secondary line** | Format and size constraints |
| **Browse button** | Optional explicit button inside dropzone |
| **Helper text** | Below native-style field |

---

## Native file field shell

| Property | Token / value |
|---|---|
| Shell | Same as `input-field.md` |
| Cursor | Pointer on control |
| `multiple` attribute | Same shell — browser shows file count |

---

## Sizes (native)

| Size | Font size | Block padding |
|---|---|---|
| Default | `font-size-sm` | `spacing-2-5` |
| Large | `font-size-lg` | `spacing-2-5` |

Width stays 100% of the parent.

---

## Variants

### File upload (default)

Label + native file input on the standard shell.

### Helper text

Helper below the control: `font-size-sm`, `body-subtle`, `spacing-1` margin-top — e.g. allowed extensions and max dimensions.

### Multiple files

The `multiple` attribute; styling is unchanged, but the helper should state that multi-select is allowed.

### Dropzone

The signature upload surface — generous, dashed, and centered.

| Property | Token / value |
|---|---|
| Min height | 256px |
| Width | 100% |
| Background | `neutral-secondary-medium` |
| Border | 1px dashed `default-strong` |
| Radius | `radius-xxl` |
| Layout | Column, centered icon + text |
| Hover background | `neutral-tertiary-medium` |
| Icon | 32 × 32px, `body` |
| Primary text | `font-size-sm`, `font-weight-semibold` on the "Click to upload" span; remainder normal |
| Secondary text | `font-size-xs`, `body-subtle` |
| Hidden input | Visually hidden; `<label for>` wraps the dropzone |
| Padding (content block) | `spacing-5` top, `spacing-6` bottom |

Drag-over state (product logic): border `brand`, optional `brand-softer` background — keep contrast readable.

### Dropzone with button

The dropzone is a non-label container with an inner **Browse file** primary button (`buttons.md`, `font-size-sm`, 16px leading icon) that triggers the hidden input.

---

## States

| State | Behavior |
|---|---|
| Default | Shell or dropzone tokens |
| Hover (dropzone) | `neutral-tertiary-medium` fill |
| Focus | Focus ring on the hidden input's focusable label/button — 4px `brand-medium` |
| Disabled | Muted border, `fg-disabled` text, no pointer events |
| Error | Dropzone border `danger-subtle`; message below per validation |

---

## Motion

Hover background ≤ 150ms; drag-over highlight ≤ 150ms. No bounce or scale on the dropzone.

---

## Accessibility

| Requirement | Implementation |
|---|---|
| Label | Visible label linked to the input |
| Dropzone | `<label for="id">` or a button with an explicit action |
| Keyboard | Space/Enter activates the file picker |
| Constraints | Helper states formats/size in text |
| Error | `aria-invalid` + error message id |

---

## Prohibited

- **No dropzone without a keyboard path** to open the file dialog.
- **No solid border on a dropzone** — the dashed `default-strong` edge is what distinguishes it from a text field.
- **No custom file button that hides the focus ring**.
- **No shadow on a dropzone** — it is flat (`elevation-none`); the dashed drop-target edge is its only affordance.
- **No corners other than `radius-xxl`** on the dropzone or native shell.
