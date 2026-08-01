# Input Field — TypeUI · Astra

> **TypeUI · Astra** — the field shell every text control inherits.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`, `dropdowns.md`

This is the foundation of every form in Astra. The field shell is a crisp **rounded** (`radius-xxl`, 24px) control on a **contrasting `neutral-tertiary` fill** (`#1A0F33`, a step lighter than the dark card/section it sits on), defined by a **`default` (`#281C40`) border** — with **no shadow**, and — on focus — a `brand` border under a `brand-medium` ring. Labels sit above in `heading`; helper and validation text sit below. Search, number, phone, file, select, and time controls all extend *this* shell, so it stays consistent unless a module explicitly overrides it. The multi-line **`textarea`** extends it too but **caps its radius at `radius-md` (16px)** — a 24px corner bows a tall box.

---

## Anatomy

| Part | Role |
|---|---|
| **Label** | Visible field name linked to control via `for` / `id` |
| **Control** | Native `<input>` or equivalent |
| **Placeholder** | Hint text when empty — not a substitute for a label |
| **Helper text** | Optional secondary copy below the field |
| **Validation message** | Success or error feedback below the field |
| **Addon (input group)** | Leading icon, prefix text, or suffix segment fused to the control |
| **Leading icon slot** | Decorative glyph inside the field shell |

---

## Field shell (default)

The single shape every standard single-line input wears.

| Property | Token / value |
|---|---|
| Width | 100% of parent |
| Background | `neutral-tertiary` (`#1A0F33`) — a contrasting fill, a step lighter than the card/section |
| Border | `default` (`#281C40`), 1px — the resting edge that defines the field |
| Radius | `radius-xxl` (24px, rounded) |
| Shadow | None (`elevation-none`) |
| Text color | `heading` |
| Placeholder color | `body` |
| Font size | `font-size-sm` |
| Line height | `line-height-component` |
| Padding (inline) | `spacing-3` |
| Padding (block) | `spacing-2-5` |
| Focus border | `brand` |
| Focus ring | `brand-medium` |
| Outline | None — ring replaces default browser outline |

---

## Focus — standalone vs composite shell

Focus must read on the **entire control**, never as a ring clipped around the placeholder text or inner `<input>` alone.

| Pattern | Where focus ring lives | Implementation |
|---|---|---|
| **Standalone `<input>`** | On the input element itself | `:focus-visible` → `brand` border + `brand-medium` ring on the field |
| **Composite shell** (leading icon, prefix addon, search bar) | On the **outer wrapper** | Wrapper gets `:focus-within` → `brand` border + `brand-medium` ring; inner `<input>` has **no** outline and **no** box-shadow |

Composite shells include search inputs with icons, footer email bars, toolbar queries, and table filter fields. The wrapper owns the border and radius; the inner input is borderless and transparent.

**Required composite CSS behavior:**

```css
.field-shell:focus-within {
  border-color: var(--color-brand);
  box-shadow: var(--focus-ring);
}

.field-shell input:focus,
.field-shell input:focus-visible {
  outline: none;
  box-shadow: none;
}
```

Never apply a global `:focus-visible` ring to nested inputs inside a composite shell — that produces a broken ring around the text/placeholder only.

---

## Label & helper typography

| Element | Size | Weight | Color | Spacing |
|---|---|---|---|---|
| Label | `font-size-sm` | `font-weight-medium` | `heading` | `spacing-2-5` below label → control |
| Helper text | `font-size-sm` | normal | `body-subtle` | `spacing-1` above helper |
| Validation message | `font-size-sm` | normal; lead-in `font-weight-medium` | Intent foreground | `spacing-2-5` above message |

A link inside helper or label is `fg-brand`, underlined on hover.

---

## Sizes

Four heights driven by padding, not fixed pixels — so a field always aligns to the button beside it.

| Size | Block padding | Inline padding | Font size |
|---|---|---|---|
| Small | `spacing-2` | `spacing-2-5` | `font-size-sm` |
| Default | `spacing-2-5` | `spacing-3` | `font-size-sm` |
| Large | `spacing-3` | `spacing-3-5` | `font-size-base` |
| Extra large | `spacing-3-5` | `spacing-4` | `font-size-base` |

Height grows from padding and line height — don't set fixed pixel heights unless a layout spec needs alignment with an adjacent button.

---

## Variants

### Default form grid

Fields stack vertically with `spacing-6` between groups. Multi-column layouts use a responsive grid with a `spacing-6` gap; each cell holds one label + control group.

Supported native types in composite forms: `text`, `email`, `password`, `url`, `tel`, `number`.

### Input group — leading icon

| Property | Token / value |
|---|---|
| Wrapper | `position: relative`; full width |
| Icon box | Absolute at inline start; vertically centered |
| Icon size | 16 × 16px |
| Icon color | `body` |
| Icon inset | `spacing-3` from inline start |
| Control padding (inline start) | `spacing-9` to clear icon |
| Icon | `pointer-events: none`; decorative only |

### Input group — prefix addon

A horizontal row where the addon segment and control share one outer radius — the fusion reads as a single rounded control.

| Part | Token / value |
|---|---|
| Row shadow | None (`elevation-none`) |
| Row border | `default` (`#281C40`) on the outer perimeter |
| Row radius | `radius-xxl` on outer corners only |
| Addon background | `neutral-quaternary` (a step lighter than the field fill, so segments read apart) |
| Addon border | A `default` (`#281C40`) divider on the shared edge separates addon from control |
| Addon padding | `spacing-3` inline |
| Addon text | `font-size-sm`, `body` |
| Addon icon | 16 × 16px, `body` |
| Field inner radius | Flush on shared edge; outer corner keeps `radius-xxl` |

Prefix examples: an `@` user icon, an `https://` URL scheme.

### Helper text

A paragraph below the control, optionally with an inline link (`fg-brand`). Link the helper id to the input with `aria-describedby`.

### Search input

Query fields use the same **field shell** with a leading magnifying glass — same crisp rounded (`radius-xxl`, 24px), same contrasting fill with a `default` border, same flat (`elevation-none`) surface, same brand focus ring on the **wrapper** via `:focus-within`. It never invents its own look; it only adds search affordances (leading icon, optional clear/voice/submit, optional scope menu). The search action is always keyboard-reachable, and any scope dropdown is drawn by `dropdowns.md`, not styled inline.

#### Search anatomy

| Part | Role |
|---|---|
| **Label** | Visible or visually hidden (`sr-only`) depending on layout |
| **Control** | `type="search"` or `type="text"` |
| **Leading icon** | Magnifying glass — default search affordance |
| **Trailing control** | Optional clear, voice, or submit button |
| **Dropdown panel** | Optional filter or scope menu (see `dropdowns.md`) |
| **Helper / scope text** | Optional hint below bar |

#### Search layout

| Property | Token / value |
|---|---|
| Field shell | Same as field shell above |
| Leading icon | 16 × 16px, `body`, inset `spacing-3` from inline start |
| Padding (inline start with icon) | `spacing-9` |
| Trailing button hit target | 32 × 32px minimum |
| Bar width | 100% of parent; advanced layouts may cap max width in the page spec |

#### Simple search

Label + field with the leading search icon; the placeholder describes the query ("Search…", "Search products…").

#### Search bar (prominent)

For hero or toolbar placement: optional `font-size-base` and `spacing-4` block padding — but only on large breakpoints, and still on the standard shell.

#### Search with dropdown

A composite row: the text field plus an adjacent scope trigger (e.g. "All categories"). The menu uses flat, `radius-xxl`, and `dropdowns.md` item spacing; gap between field and trigger is `spacing-2`.

#### Location search

A leading location-pin icon in place of the magnifying glass — same shell and padding.

#### Voice search

A trailing icon button for the voice affordance (16 × 16px icon, ghost hover at `neutral-tertiary-medium`); the field's inline-end padding clears the button.

#### Advanced search

A multi-control toolbar: the primary field plus filter chips and/or secondary buttons (`buttons.md`). The field keeps the standard shell; the vertical gap between toolbar rows is `spacing-4`.

#### Search states & motion

Focus, disabled, and validation come from the field shell rules above. **Composite search bars** (icon + input) put the focus ring on the **wrapper** via `:focus-within`, not on the inner `<input>`. Trailing icon buttons use the button focus ring (4px `brand-medium`). A clear button appears once the field has a value (product logic) and carries `aria-label="Clear search"`. Focus ring ≤ 150ms. Optional fade for the clear button — ≤ 150ms, with no layout shift.

#### Search accessibility

| Requirement | Implementation |
|---|---|
| Role | `type="search"`, or `role="search"` on the containing form |
| Label | Visible label or `aria-label` on the input |
| Icon buttons | Accessible name ("Search", "Start voice search", "Clear") |
| Dropdown scope | `aria-expanded`, `aria-controls` on the trigger |
| Results | Live region or linked results list documented in the page pattern — not part of this shell |

#### Search prohibited

- **No divergent field shell** — same border, rounded (24px) radius, and elevation as the standard field shell.
- **No submit-only placeholder** — the search action is reachable by Enter or a button.
- **No icon-only search without an accessible name**.
- **No dropdown panel styled inline** — use `dropdowns.md`.
- **No focus ring on the inner input alone** — the whole search shell (icon + field) lights up together via the composite focus rule above.


### Dropdown input (combobox-style)

A text shell with a trailing chevron or menu affordance; the panel follows `dropdowns.md`. The shell is unchanged — the chevron sits in the trailing slot.

---

## Validation states

Validation recolors the whole shell so it reads at a glance — but never on color alone; a message always accompanies it.

| State | Background | Border | Text / placeholder | Focus ring |
|---|---|---|---|---|
| Default | `neutral-tertiary` (`#1A0F33`) | `default` (`#281C40`) | `heading` / `body` | `brand-medium` |
| Success | `success-soft` | None (intent fill + ring) | `fg-success-strong` | `success` |
| Error | `danger-soft` | None (intent fill + ring) | `fg-danger-strong` | `danger` |

Label color matches the intent foreground on success and error (`fg-success-strong`, `fg-danger-strong`). The message uses the same foreground; its first clause may take `font-weight-medium` for emphasis ("Well done!", "Oh, snap!").

---

## States

| State | Visual / behavior |
|---|---|
| Default | Field shell tokens above |
| Hover | Background unchanged (matches surface); border may deepen toward `default-strong` |
| Focus | Resting `default` border swaps to `brand` + 4px `brand-medium` ring |
| Filled | Same as default; value uses `heading` |
| Disabled | Text `fg-disabled`; no pointer events; native `disabled` |
| Read-only | Same visuals as disabled in examples; use `readonly` + `disabled` styling or a dedicated read-only token if the product distinguishes them |
| Invalid (native) | Prefer the explicit error variant over browser default styling |

---

## Motion

| Interaction | Duration | Notes |
|---|---|---|
| Focus ring | Instant or ≤ 150ms | Ring appears on `:focus-visible` |
| Border color on focus | ≤ 150ms | Optional subtle transition |

No scale, bounce, or shadow animation on the field shell.

---

## Accessibility

| Requirement | Implementation |
|---|---|
| Label | Every input has a visible `<label>` or an `aria-label` when the design hides the label |
| Helper / error | `aria-describedby` references the helper and/or error element ids |
| Invalid | `aria-invalid="true"` when an error state shows |
| Required | `required` attribute plus a visual indicator if form policy needs one |
| Focus | Visible `:focus-visible` ring on the **whole control** — standalone input or composite wrapper via `:focus-within`, never ring on inner input only |
| Placeholder | Not the only accessible name |
| Input group icons | `aria-hidden="true"` when decorative |
| Color | Success/error never rely on color alone — a message is required |

---

## Prohibited

- **No corners other than `radius-xxl`** (24px) on the shell — rounded is the signature; a fused input group keeps 24px on its outer corners only.
- **No shadow on a resting input** — the field is flat (`elevation-none`); contrast comes from the fill.
- **No same-as-surface fill** — the field uses the contrasting `neutral-tertiary` (`#1A0F33`) fill plus the `default` (`#281C40`) border so it reads on the dark surface; focus swaps the border to a `brand` edge.
- **No removing the focus ring** without an accessible replacement.
- **No focus ring on the inner input of a composite shell** — search/icon/prefix wrappers use `:focus-within` on the outer shell so the ring wraps the full field, not the placeholder text alone.
- **No placeholder-only labeling** for required fields.
- **No success/error colors on a default field** without an accompanying validation message.
- **No mixing validation intents** on one field — one message, one intent.
- **No raw hex or off-scale spacing**, and **no framework/vendor class names** — foundation tokens only.
