# Textarea — TypeUI · Astra

> **TypeUI · Astra** — multi-line text: plain, editor chrome, comment box, and chat input.
> Depends on: `input-field.md`, `buttons.md`, `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`

A textarea is the Astra **field shell** from `input-field.md` grown to multiple lines — same contrasting `neutral-tertiary` (`#1A0F33`) fill with a `default` border, flat (`elevation-none`), and brand focus ring, with `rows` setting the min height — but its corner is **capped at `radius-md` (16px)**, never the 24px shell (a tall multi-line box bows at full rounding). Richer patterns (WYSIWYG, comment box, chat) wrap the field in a single rounded composite card: the inner textarea goes borderless and the **focus ring moves to the wrapper**, so the whole composite lights up as one control rather than ringing a box inside a box.

---

## Anatomy

| Part | Role |
|---|---|
| **Label** | Field name above or visually hidden inside composites |
| **Control** | `<textarea>` |
| **Toolbar** | Optional row of icon actions above text (WYSIWYG) |
| **Footer row** | Submit button + secondary icon actions |
| **Helper / guideline** | Text below composite |

---

## Default textarea shell

| Property | Token / value |
|---|---|
| Shell | Same border, background, radius, shadow as `input-field.md` |
| Padding | `spacing-3-5` all sides |
| Font size | `font-size-sm` |
| Text color | `heading` |
| Placeholder | `body` |
| Min height | From `rows` attribute × line height |
| Resize | Vertical resize allowed unless layout forbids |
| Focus | Border `brand`, 4px `brand-medium` ring |

---

## Variants

### Textarea example (default)

Label + textarea + optional placeholder ("Write your thoughts here…").

### WYSIWYG editor

A composite card wrapping toolbar + text area + submit — one rounded shell around the whole thing.

| Part | Token / value |
|---|---|
| Outer wrapper | `default` (`#281C40`) border, `radius-xxl`, `neutral-tertiary` (`#1A0F33`) contrasting fill, flat (`elevation-none`) |
| Toolbar | Row between top border and text; padding `spacing-2` `spacing-3`; bottom border 1px `default-medium` |
| Toolbar buttons | 32 × 32px hit area; icon 20 × 20px; `body` color; hover `neutral-tertiary-medium`, text `heading` |
| Toolbar dividers | Vertical `default-medium` between button groups on wide viewports |
| Text area | Borderless inside wrapper; padding `spacing-4` `spacing-2`; background matches wrapper; inner focus ring suppressed — the ring shows on the wrapper when any child is focused |
| Submit | Primary button below wrapper; `spacing-4` gap |

### Comment box

| Part | Token / value |
|---|---|
| Wrapper | Same bordered (`default`), flat rounded card as WYSIWYG, without the top toolbar |
| Text area | Top section; padding `spacing-4` `spacing-2`; borderless; placeholder `body` |
| Footer | Row with top border `default-medium`; padding `spacing-2` `spacing-3` |
| Submit button | Primary, small size (`buttons.md`) |
| Footer icon actions | Ghost icon buttons 32 × 32px; gap `spacing-1` |
| Guideline below | `font-size-xs`, `body-subtle`, inline-end aligned; link `fg-brand` |

### Chatroom input

A single-row composite — visually short, not a tall textarea.

| Part | Token / value |
|---|---|
| Outer row | Flex row; padding `spacing-2` `spacing-3`; background `neutral-secondary-soft`; `radius-xxl` |
| Leading actions | Icon buttons 32 × 32px |
| Text control | Flex-grow; single-line height with `rows="1"`; shell on a contrasting `neutral-tertiary` (`#1A0F33`) fill with a `default` border, `radius-xxl`, padding `spacing-2-5` `spacing-3` |
| Send button | Icon-only; `fg-brand`; hover `brand-softer`; circular or square 32 × 32px |
| Send icon | 24 × 24px; rotated paper plane |

---

## States

Disabled and validation inherit from `input-field.md`. Toolbar buttons use the icon-button hover/focus pattern, and the composite wrapper shows focus when its textarea is focused. Read-only may mute the text; the shell is unchanged.

---

## Motion

Toolbar hover ≤ 150ms; chat send hover ≤ 150ms. No auto-resize animation required.

---

## Accessibility

| Requirement | Implementation |
|---|---|
| Label | Visible, or `sr-only` inside a composite with `aria-label` |
| Toolbar | Each icon button has an `aria-label` |
| WYSIWYG | Don't imply formatting works unless it's implemented |
| Guideline | Linked via `aria-describedby` when instructional |
| Required | `required` + validation message |

---

## Prohibited

- **No borderless textarea outside a defined composite** — always a shell or wrapper border (the simple textarea shell at `radius-md` / 16px; a composite wrapper card at `radius-xxl`).
- **No inner textarea focus ring fighting the wrapper ring** — one focus indicator per composite.
- **No toolbar icons without accessible names**.
- **No chat send as a `<div>`** — use `<button type="submit">`.
