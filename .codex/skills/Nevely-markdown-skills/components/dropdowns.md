# Dropdowns — TypeUI · Astra

> **TypeUI · Astra** — transient menus for actions, navigation, filters, and selectors.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`, `buttons.md`

A dropdown is a floating menu anchored to a trigger — never a permanent navigation rail. The Astra panel is a crisp **rounded** (`radius-xxl`, 24px) surface on `neutral-primary-medium` — **borderless and flat**, reading as a *lighter panel floating over the section* (it sits above the page, below modals). Items sit inside at the smaller `radius-md` — the concentric inner corner of a padded square parent, not an exception to the rule. Menus open on click by default, trap nothing, and return focus to the trigger on close.

---

## Anatomy

| Part | Role |
|---|---|
| **Trigger** | Button, icon button, or avatar — opens menu |
| **Menu** | Floating panel |
| **List** | Menu items |
| **Item** | Link or button row |
| **Divider** | Horizontal rule between groups |
| **Header** | Non-interactive title or label row |
| **Checkbox / radio / switch item** | Selectable row |
| **Search field** | Filter inside menu (scrollable lists) |

---

## Layout

### Menu panel

| Property | Token / value |
|---|---|
| Background | `neutral-primary-medium` (a lighter panel over the section) |
| Border | **1px in the panel's own fill, darkened ~10–15%** — a subtle derived edge so the menu reads against the page (see the dropdown panel rule) |
| Radius | `radius-xxl` |
| Shadow | **Medium** (`elevation-2`) — a real medium drop shadow; the dropdown is a floating overlay, the one documented exception to the otherwise-flat system |
| Padding | `spacing-2` around list |
| Width | **Auto** — sized to the longest item's text; clamp ~144px min to ~320px max, then wrap/scroll. Never a fixed wide block |
| Max height | **None by default — the menu grows to fit every item and never scrolls.** Apply a `~320px`-then-scroll cap **only when the prompt explicitly asks for a scrollable list** (see the Scrollable variant) |
| Z-index | Above cards; below modals |

### Menu item

Menu items are rounded (`radius-md`, 16px) — concentric inside the 24px panel (see `radius.md`).

| Property | Token / value |
|---|---|
| Padding | `spacing-2` |
| Radius | `radius-md` |
| Font | font-size-sm, font-weight-medium, line-height-component |
| Color | `body` |
| Hover | `neutral-tertiary-medium` background, `heading` text |
| Width | 100% of menu inner width |

### Divider

1px `default-medium`; vertical margin `spacing-2`.

### Header row

font-size-sm, font-weight-semibold, `body-subtle`; padding `spacing-2`; not hoverable.

### Trigger chevron

16px trailing on a default button trigger; gap `spacing-1-5`.

---

## Sizes

| Size | Menu width | Item padding |
|---|---|---|
| Small | **Auto** (fits longest item) | `spacing-1-5` |
| Default | **Auto** (fits longest item) | `spacing-2` |
| Large | **Auto** (fits longest item) | `spacing-2-5` |

Menu **width is always auto** — sized to the longest item's text within the ~144–320px clamp; only the item padding changes by size. The trigger follows the `buttons.md` base size unless it's icon-only.

---

## Overlay & stacking — always on top

A dropdown must paint **above everything else on the page** so its contents stay readable; nothing may cover an open menu.

- **Escape the parent stacking context with a portal.** A `z-index` alone is **not enough** — if the trigger sits inside a card, toolbar, or row with its own stacking context (`transform`, `opacity`, `position`, `overflow`, `filter`), the menu is clipped or later siblings paint on top of it. Render the menu in a **portal to `document.body`** (a top-level overlay root), positioned with **`position: fixed`** anchored to the trigger.
- **Top of the page layer.** The portalled menu sits at the **dropdown layer — `z-index: 200`** — above all page content (cards, banners, sticky bars, sibling rows), below modals/drawers. An open menu always fully covers whatever is behind it.
- **Re-anchor on scroll/resize.** Because it is `position: fixed`, recompute the menu's coordinates against the trigger on scroll and resize (and flip when the viewport runs out — see Placement).

### Controls inside a menu are Small

Every interactive control **inside** a dropdown menu uses the **Small** size — small inputs (the search field), small option rows (checkbox / radio items), and **small** footer buttons. **Never Base or Large inside a menu** — the menu is a compact surface.

---

## Placement

The menu anchors to the trigger with a preferred placement (bottom-start, bottom-end, top-start, top-end, or inline) and flips when the viewport runs out. Default offset from the trigger is **`spacing-2`** (configurable).

---

## Interaction

| Mode | Behavior |
|---|---|
| **Click (default)** | Toggle on trigger click; close on outside click or Escape |
| **Hover** | Open on pointer enter; 300ms show/hide delay default; 500ms optional |
| **Offset** | Distance from trigger edge — `spacing-2` base |

Multi-level: a nested submenu opens inline-end with the same panel tokens.

**Selection menus stay open on click.** In a menu of **checkbox, radio, or filter** options, clicking an option **selects / toggles it and keeps the menu open** — it does **not** dismiss on selection. These menus close only on **outside click, Escape, or an explicit Apply / Done** button. (Plain action or navigation menus — Edit, Sign out, a nav link — close on click as normal.)

**The open menu is always the topmost thing.** It paints **over the content directly beneath it** (expected — the menu must be readable); no row, banner, or sibling ever paints over the menu (see Overlay & stacking).

---

## Variants

### Default list

Text items only — Dashboard, Settings, Sign out.

### With divider

Grouped sections separated by a divider.

### With header

A section label above an item group.

### Checkbox list

A row of checkbox + label for multi-select; the checked state uses the brand accent on the control. The checkbox box stays a **16 × 16px square** (`radius-none`) — never rounded or pill-shaped, even inside a filter panel.

### Radio list

Single-select, mutually exclusive options.

### Toggle row

A switch + label for a boolean setting.

### Scrollable

**Opt-in only — use this *only* when the prompt explicitly asks for a scrollable menu.** A fixed max height with scroll inside the menu. By default a dropdown has **no scroll** and shows all of its items at once.

### With search

A search input pinned to the top with the filtered list below — the input uses the compact spec from `input-field.md`.

### Icon trigger

A kebab / vertical-dots icon button opens the menu.

### Notification bell

An icon trigger with a badge; the menu lists notifications.

### User avatar

An avatar trigger; the menu holds account actions.

### Navbar dropdown

A nav-link trigger with an optional wide menu for mega patterns.

### Datepicker / complex

A composite panel — date cells follow the calendar spec when documented.

---

## Motion

| Transition | Duration | Properties |
|---|---|---|
| Open / close | 150–200ms | Opacity + slight scale (optional) |
| Hover delay | 300ms default | — |

---

## Accessibility

- Trigger: `aria-expanded`, `aria-haspopup="menu"`.
- Menu: `role="menu"`; items `role="menuitem"` (or `menuitemcheckbox` / `menuitemradio`).
- Focus the first item on open; arrow keys navigate; Escape closes.
- Return focus to the trigger on close.
- Checkbox/radio items use standard input labeling.

---

## Prohibited

- **No flat, borderless menu panel** — the dropdown is a floating overlay: it carries a **medium drop shadow** (`elevation-2`) and a **subtle derived border** (its own fill darkened ~10–15%) so it lifts off and reads against the page. (Only floating overlays get this shadow; resting cards and sections stay flat.)
- **No hover-only menus on touch-primary flows** without a click equivalent.
- **No auto-close when toggling a checkbox / radio / filter option** — selection menus stay open while options are chosen; they dismiss only on outside click, Escape, or an explicit Apply / Done.
- **No fixed or oversized menu width** — the panel width is **auto**, sized to the longest item's text (clamped ~144–320px); never a fixed wide block that leaves empty gutters beside short labels.
- **No menu wider than the viewport** — constrain and scroll.
- **No dropdown trapped in a parent stacking context** — portal the menu to `document.body` with `position: fixed`; a parent's `transform` / `overflow` / `opacity` / `position` otherwise clips it or lets later siblings paint over it. A `z-index` alone is not enough.
- **No element painting over an open menu** — the portalled menu sits at the dropdown layer (`z-index: 200`, below modals) and covers everything behind it.
- **No Base or Large controls inside a menu** — inner inputs, option rows, and buttons are always the **Small** size.
- **No rounded checkboxes in menus** — filter / checkbox menu rows use a **square** tick box (`radius-none`), never a pill or circle. See `checkbox.md`.
- **No destructive action without visual emphasis** — danger text or divider isolation.
- **No nested scroll fighting page scroll** — lock the menu's scroll container.
- **No more than two menu levels** in default patterns.
- **No raw shadow or color values**, and no framework data-attribute names — semantic tokens only.
