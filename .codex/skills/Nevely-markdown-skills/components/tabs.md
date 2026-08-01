# Tabs — TypeUI · Astra

> **TypeUI · Astra** — section switching and supplementary navigation.
> Depends on: `colors.md`, `radius.md`, `spacing.md`, `typography.md`

Tabs split content into mutually exclusive panels or route-level navigation. Astra ships three flavors — a soft-filled **default**, a clean **underline**, and **pills** — and the active tab always speaks in `fg-brand`. The default and pill variants take the signature **rounded** (`radius-xxl`, 24px) shell; underline stays minimal with a 2px brand rule. Keep tab bars short and single-level; past ~7 tabs, move to an overflow menu.

---

## Anatomy

| Part | Role |
|---|---|
| **Tab list** | Row or column of tab triggers |
| **Tab** | Selectable label (link or button) |
| **Indicator** | Background fill or underline showing active tab |
| **Panel** | Content region tied to active tab |
| **Icon** | Optional leading glyph in tab label |

---

## Typography

| Element | Size | Weight | Line height | Color |
|---|---|---|---|---|
| Tab label | font-size-sm | font-weight-medium | line-height-component | See states |
| Panel body | font-size-sm | font-weight-normal | line-height-body | `body` |
| Panel emphasis | font-size-sm | font-weight-medium | line-height-body | `heading` |

---

## Layout

| Property | Token / value |
|---|---|
| Tab padding | `spacing-4` all sides (default variant) |
| Gap between tabs | `spacing-2` |
| List bottom border | 1px `default` (underline / default variants) |
| Panel padding | `spacing-4` |
| Panel gap below list | flush — panel abuts list or shares border |
| Icon size | 16 × 16px |
| Icon gap | `spacing-2` |
| Full-width tabs | Equal flex columns; each tab `width: 100%` of column |

---

## Variants

### Default (filled active)

| State | Text | Background |
|---|---|---|
| Active | `fg-brand` | `neutral-secondary-soft` |
| Inactive | `body` | transparent |
| Hover | `heading` | `neutral-secondary-soft` |
| Disabled | `fg-disabled` | transparent; no pointer |

The active tab rounds its top corners at `radius-xxl`; the list carries a `default` bottom border.

### Underline

| State | Text | Bottom border |
|---|---|---|
| Active | `fg-brand` | 2px `brand` |
| Inactive | `body` | transparent |
| Hover | `fg-brand` | 1px `brand-subtle` |
| Disabled | `fg-disabled` | none |

Negative-margin trick: the tab list overlaps the container's bottom border by 1px so the active underline meets the list edge.

### Pills

| State | Text | Background |
|---|---|---|
| Active | `heading` | `brand` |
| Inactive | `body` | transparent |
| Hover | `heading` | `neutral-secondary-soft` |
| Disabled | `fg-disabled` | transparent |

Inactive/hover and active pills both use `radius-xxl`; the active pill takes the brand fill.

### With icons

Underline or default styling plus a 16px leading icon; the icon inherits the tab text color and shifts to `fg-brand` on group-hover.

### Vertical

A tab list column at the inline start (~256px wide), items full-width of the column, panels at the inline end — same state tokens as the underline variant.

### Full width

Tabs stretch evenly across the container — for marketing or settings with few tabs.

### Interactive (panel switching)

Tab triggers are **buttons** with `role="tab"`; one **panel** shows at a time (`role="tabpanel"`), and inactive panels leave both view and tab order (`hidden`/`display:none`). The active underline variant uses a 2px `brand` bottom border; inactive tabs are transparent. The panel container is `spacing-4` padding, `radius-xxl`, on `neutral-secondary-soft`.

---

## States reference

| State | Default | Underline | Pills |
|---|---|---|---|
| Active | brand text + soft bg | brand text + brand border | `heading` on brand |
| Hover | heading + soft bg | brand text + subtle border | heading + soft bg |
| Disabled | fg-disabled | fg-disabled | fg-disabled |

---

## Motion

150ms color/background/border on tab change. Panel swap is instant or a 150ms opacity fade — no sliding panels unless a product spec adds it.

---

## Accessibility

- Tab list: `role="tablist"`.
- Tab: `role="tab"`, `aria-selected="true|false"`, `aria-controls="{panelId}"`.
- Panel: `role="tabpanel"`, `aria-labelledby="{tabId}"`.
- Arrow keys Left/Right (or Up/Down for vertical) move between tabs.
- Disabled tabs: `aria-disabled="true"`, excluded from activation.
- URL-based tabs use real `href`s — no fake buttons.

---

## Prohibited

- **No mixing pill and underline styles** in one tab list — pick one flavor.
- **No more than ~7 tabs** in a row without an overflow menu.
- **No nested tab bars** at the same hierarchy level.
- **No tab labels in ALL CAPS** — sentence case.
- **No hiding the only panel heading** — the tab names the section; the panel may repeat it for context.
- **No raw colors or spacing**, and no framework class/data-attribute names — foundation tokens only.
