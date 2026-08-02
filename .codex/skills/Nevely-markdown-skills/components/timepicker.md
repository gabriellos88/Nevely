# Timepicker — TypeUI · Astra

> **TypeUI · Astra** — time entry: native input, icon triggers, dropdowns, ranges, and presets.
> Depends on: `input-field.md`, `select.md`, `dropdowns.md`, `toggle.md`, `modal.md`, `drawer.md`, `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`

A timepicker starts as the Astra **field shell** from `input-field.md` with a trailing clock — same crisp rounded (`radius-xxl`, 24px), surface-matching fill with a `default` border, flat (`elevation-none`), and brand focus ring. Everything beyond that is composition, not reinvention: panels come from `dropdowns.md`, wheels from `select.md`, presets from `buttons.md`, mode switches from `toggle.md`. Ranges always label both endpoints.

---

## Anatomy

| Part | Role |
|---|---|
| **Label** | Field or range label |
| **Control** | `type="time"`, text shell, or select pair |
| **Trailing icon** | Clock glyph opening picker |
| **Dropdown panel** | List of times or hour/minute columns |
| **Range ends** | Start time + end time fields |
| **Preset buttons** | Inline quick picks (e.g. "09:00", "12:00") |
| **Toggle** | AM/PM or 24h mode (`toggle.md`) |

---

## Core field shell

| Property | Token / value |
|---|---|
| Shell | Same as `input-field.md` |
| Trailing icon button | 16 × 16px clock, inset inline-end `spacing-3`; padding-inline-end on field `spacing-9` |
| Icon wrapper | Optional absolute positioning like the search leading icon |

---

## Variants

### Default timepicker

Label + time input on the standard shell; the browser-native picker is fine where skinning is limited.

### Timepicker with icon

A decorative or clickable clock at the inline end. If clickable, the icon button opens a custom panel (`aria-haspopup="dialog"` or `listbox`).

### Timepicker with dropdown

A field trigger plus a dropdown menu (`dropdowns.md`, flat, `radius-xxl`). Items: `font-size-sm`, row padding `spacing-2` `spacing-3`, hover `neutral-tertiary-medium`; the selected time uses `brand-softer` or a checkmark.

### Timepicker with select

Hour and minute `<select>`s side by side (`spacing-2` gap), each following `select.md`, with an optional AM/PM third select.

### Timepicker range selector

Two time fields with a "to" separator (`body`, `font-size-sm`) between them, `spacing-4` gap, labeled "Start" / "End" or under one legend.

### Timerange with dropdown

A single field summarizing the range that opens a panel of two inner time selects or native inputs; panel padding `spacing-4`, `radius-xxl`, flat.

### Timerange with toggle

A range row plus a toggle for "All day" or 24h mode (`toggle.md`); vertical gap `spacing-4`.

### Inline timepicker buttons

A row of preset pill buttons (`buttons.md` outline or secondary, small); the active preset takes a primary or `brand-softer` fill, `spacing-2` gap, with an optional time field beside the row.

### Modal / drawer with timepicker

Time controls embedded in a `modal.md` or `drawer.md` form body — field tokens unchanged; placement and section spacing come from the container.

---

## States

Focus, disabled, and validation inherit from `input-field.md`. An open dropdown turns the trigger border `brand`. An invalid range (end before start) surfaces an error message on the group.

---

## Motion

Dropdown open ≤ 200ms per `dropdowns.md`. Icon button hover ≤ 150ms.

---

## Accessibility

| Requirement | Implementation |
|---|---|
| Label | Each input labeled; a range uses `<fieldset>` + `<legend>` |
| Custom picker | Keyboard-navigable list; `aria-selected` on the active time |
| Icon trigger | `aria-label` "Open time picker" |
| 24h vs 12h | Don't rely on color — label AM/PM explicitly |
| Live region | Optional polite announcement when a preset is applied |

---

## Prohibited

- **No time range without both endpoints labeled**.
- **No dropdown panel outside `dropdowns.md` tokens** (`radius-xxl`, flat).
- **No icon-only time field without an accessible name**.
- **No modal timepicker that traps focus without `modal.md` rules**.
