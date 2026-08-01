# Drawer — TypeUI · Astra

> **TypeUI · Astra** — off-canvas panels for navigation, forms, and detail sheets.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`, `buttons.md`

A drawer slides in from a viewport edge — unlike a modal, it's anchored to that edge and often keeps wayfinding context in view. It shares the modal's `neutral-primary-soft` lighter-panel surface and is **borderless and flat** (`elevation-none`) — separated from the page by that lighter surface and the backdrop scrim — but its corners follow the **edge-anchored exception** to the 24px rounded rule: edges flush against the viewport stay square, and only the free inward edges round to `radius-xxl` (24px). A full-height side drawer keeps its flush edge square by design.

---

## Anatomy

| Part | Role |
|---|---|
| **Backdrop** | Optional scrim over page |
| **Panel** | Fixed sheet |
| **Header** | Title, logo, close control |
| **Body** | Scrollable content |
| **Footer** | Optional action row |
| **Trigger** | External control that opens drawer |

---

## Layout

| Property | Token / value |
|---|---|
| Panel background | `neutral-primary-soft` (a lighter panel over the scrim) |
| Panel border | None — the lighter panel surface and the backdrop scrim separate it from the page |
| Panel radius | **Square on edges flush to the viewport**; the inward free edge may take `radius-xxl` (24px). A full-height side drawer stays square — see the edge-anchored exception in `radius.md` |
| Panel shadow | None (`elevation-none`) |
| Default width | 320px (`spacing-80` scale) or 384px for content-heavy |
| Height | Full viewport height (side drawers) or auto (bottom sheet) |
| Padding | `spacing-4` panel inset |
| Header bottom border | 1px `default`; padding bottom `spacing-4`; margin bottom `spacing-5` |
| Body | `overflow-y: auto` |
| Footer gap | `spacing-4` between actions |
| Z-index | Above page, below toast layer — stacking context documented per product |

### Close control

**24 × 24px max** — the close (×) button is capped at 24 × 24px in drawers; icon 20px; absolute top `spacing-2-5` trailing `spacing-2-5`; hover `neutral-tertiary`; radius `radius-md`.

### Header title

font-size-lg, font-weight-medium, `body` or `heading` color; optional 20px leading icon with a `spacing-1-5` gap.

---

## Placement

| Placement | Transform hidden | Border emphasis |
|---|---|---|
| **Start (left LTR)** | Off-canvas inline-start | Border inline-end |
| **End (right LTR)** | Off-canvas inline-end | Border inline-start |
| **Top** | Above viewport | Border bottom |
| **Bottom** | Below viewport | Border top |

RTL mirrors start/end.

---

## Variants

### Default

Header + body copy + footer buttons (secondary + primary from `buttons.md`).

### Navigation

A logo row over a vertical link list — item padding `spacing-2` × `spacing-1-5`, hover `neutral-tertiary`, 20px icon + `spacing-3` gap, nested items indented `spacing-10`. Badges are allowed on items.

### Contact / lead form

Form fields in the body, submit in the footer.

### Form elements showcase

Mixed inputs — follow `input-field.md`.

### Body scroll modes

| Mode | Behavior |
|---|---|
| **Locked** | Page scroll disabled while open |
| **Scrollable** | Page scrolls behind drawer |

### Backdrop

| Mode | Scrim |
|---|---|
| **Visible** | Semi-transparent overlay `rgba(0,0,0,0.5)` or `neutral-primary-strong` at documented opacity — tap closes |
| **Hidden** | No scrim; click-outside may still close |

### Swipeable edge (mobile)

A partial peek of the drawer handle when closed — an optional product pattern; 16px visible edge.

---

## Motion

| Transition | Duration | Properties |
|---|---|---|
| Panel slide | 300ms | Transform translate |
| Backdrop fade | 300ms | Opacity |
| Easing | ease-out | — |

Hidden: translated fully off-screen. Open: flush to the chosen edge. Respect **reduced-motion**: instant open/close or fade only.

---

## Accessibility

- Panel: `role="dialog"`, or `role="navigation"` for nav-only; `aria-modal="true"` when it behaves modally.
- Label: `aria-labelledby` pointing to the header title id.
- Trigger: `aria-controls` + expanded state.
- Trap focus while open; restore focus to the trigger on close.
- Close: a visible control plus `Escape` dismiss.
- Announce the scroll lock only if content requires it.

---

## Prohibited

- **No rounding an edge flush to the viewport** — the flush edge stays square; only free inward edges round to `radius-xxl` (24px).
- **No drawer width below 280px** for form content.
- **No nested drawers** — close the current one first.
- **No shadow on the drawer** — it is flat (`elevation-none`); separation is the backdrop scrim plus its lighter panel surface.
- **No duplicating primary page content** inside a drawer without user intent.
- **No raw colors or shadow strings**, and no framework-specific data attributes — describe open/close behavior agnostically with semantic tokens.
