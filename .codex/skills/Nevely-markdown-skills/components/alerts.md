# Alerts — TypeUI · Astra

> **TypeUI · Astra** — inline, persistent status messaging.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`

An Astra alert is a calm, flat (`elevation-none`) **rounded** (`radius-xxl`, 24px) panel filled with its intent's soft color and written in that intent's foreground. It lives *in the flow* of the page and stays until dismissed or resolved — it is not a toast and never auto-times-out. Intent is meaning, not decoration: the brand-tinted info, green success, red danger, and orange warning fills each mean exactly what they say, and one alert carries exactly one intent. Depth stays on the ground — lifting an alert off the page is the job of modals and dropdowns, not this component.

---

## Anatomy

| Part | Role |
|---|---|
| **Root** | Full-width or inline container with background, radius, and optional border |
| **Leading icon** | Optional status glyph at inline start |
| **Content** | Message text — plain, titled, or with list |
| **Title / emphasis** | Short bold lead-in within the message (`font-weight-medium`) |
| **Inline link** | Optional anchor inside body copy |
| **List** | Optional bullet list below a lead sentence |
| **Dismiss control** | Optional icon button at inline end |
| **Badge** | Optional pill label in announcement variant |
| **Trailing icon** | Optional chevron in announcement variant |
| **Action** | Optional button below body in expanded variant |

---

## Layout

### Root (default block alert)

| Property | Token / value |
|---|---|
| Width | 100% of parent (block); auto width for announcement variant |
| Direction | Horizontal row when icon and/or dismiss present |
| Padding | `spacing-4` all sides |
| Margin below (stacked alerts) | `spacing-4` |
| Alignment (icon row) | Center vertically on wide viewports; start-aligned on narrow when text wraps |
| Gap (icon ↔ content) | `spacing-2` |
| Gap (content ↔ dismiss) | Auto — dismiss pushed to inline end |
| Gap (title ↔ body in expanded variant) | `spacing-2` above body block |
| Gap (body ↔ action in expanded variant) | `spacing-4` below body block |

### Leading icon

| Property | Token / value |
|---|---|
| Size | 16 × 16px |
| Color | Inherits intent foreground token |
| Shrink | Fixed box — never compresses |
| Optical offset | `spacing-0-5` top nudge when row is start-aligned; none when vertically centered |

Default glyph: an **info circle** (stroke style) for every intent unless a spec names an intent-specific icon.

### Dismiss control

| Property | Token / value |
|---|---|
| Size | **20 × 20px max** — the close (×) button is capped at 20 × 20px in alerts |
| Icon inside | 16 × 16px close (×) stroke |
| Position | Inline end; vertically centered with first line of content |
| Inner padding (some intents) | `spacing-1-5` |
| Optical inset | Negative `spacing-1-5` margin on inline/block axis to align glyph with alert edge |
| Corner radius | `radius-md` |

### List inside alert

| Property | Token / value |
|---|---|
| Gap below lead sentence | `spacing-2` |
| Gap between list items | `spacing-1` |
| Inline-start inset | `spacing-2-5` |
| Marker | Disc, outside position |
| Item text | Same as body (`font-size-sm`, intent foreground) |

---

## Typography

Alerts hold at `font-size-sm` throughout — even a titled or expanded alert never borrows the heading scale. Emphasis comes from weight, not size.

| Element | Size | Weight | Line height | Color |
|---|---|---|---|---|
| Body / message | font-size-sm | font-weight-normal | line-height-body | Intent foreground (see table below) |
| Title / emphasis span | font-size-sm | font-weight-medium | line-height-body | Same as body |
| Expanded heading (h3 slot) | font-size-sm | font-weight-medium | line-height-body | Same as body |
| Inline link | font-size-sm | font-weight-medium | line-height-body | Same as body + underline |
| Inline link (hover) | font-size-sm | font-weight-medium | line-height-body | Underline removed |
| Visually hidden intent label | font-size-sm | — | — | Screen-reader only |

All alert copy uses **`font-family`**. Do not use heading-scale sizes inside alerts — even titled alerts stay at **`font-size-sm`**.

---

## Intents

Each intent maps a background, foreground, and border token from `colors.md`. Pick the intent that matches the message — one intent per alert root, never for flavor.

| Intent | Background | Foreground | Border (bordered variants) |
|---|---|---|---|
| **Info** | `brand-softer` | `fg-brand-strong` | `brand-subtle` |
| **Success** | `success-soft` | `fg-success-strong` | `success-subtle` |
| **Danger** | `danger-soft` | `fg-danger-strong` | `danger-subtle` |
| **Warning** | `warning-soft` | `fg-warning` | `warning-subtle` |
| **Neutral** | `neutral-secondary-medium` | `heading` | `default-medium` |

---

## Border & radius

Block alerts and the inline announcement both wear the signature **rounded** (`radius-xxl`, 24px) — nothing rounds.

| Variant | Border | Radius |
|---|---|---|
| **Default** | None | `radius-xxl` |
| **Bordered** | 1px intent border on all sides | `radius-xxl` |
| **Top accent** | 4px (`spacing-1`) intent border on **top edge only**; no side/bottom border | `radius-xxl` on bottom corners; top edge square against accent bar |
| **Announcement** | 1px intent border on all sides | `radius-xxl` (24px, rounded) |

Default alert shells use **`elevation-none`** — depth comes from color, not shadow.

---

## Shadow

| Variant | Shadow |
|---|---|
| Default, bordered, top accent, list, dismissible | `elevation-none` |
| Announcement (inline pill) | `elevation-none` |
| Action button inside expanded alert | Follow button component — typically `elevation-none` on primary action |

Never add elevation to the alert root to "lift" it off the page — that role belongs to modals and dropdowns.

---

## Variants

### Default

Soft intent background, no border, no icon required.

```
[ optional emphasis title + body text in font-size-sm ]
```

### With icon

Default plus a 16px leading icon. Content may be a single paragraph or `<p>` wrapper, with an emphasis span before the rest of the sentence (`spacing-1` gap after the emphasis word).

### Bordered

Default or icon layout plus a **1px** intent border on the full perimeter — use it when the alert sits on a surface that matches its background and needs a defined edge.

### With list

Icon + content column: a lead sentence in `font-weight-medium`, then a disc list below at the spacing in the list table above.

Include a **visually hidden** intent name (e.g. "Danger") for screen readers when the visible copy doesn't state the intent.

### Dismissible

Icon row + message + dismiss control; the message column gains a `spacing-2` inset from the icon when a dismiss is present.

Dismiss button states:

| State | Info | Danger | Success | Warning | Neutral |
|---|---|---|---|---|---|
| Default | Transparent; `fg-brand-strong` icon | `danger-soft` fill; `fg-danger-strong` icon | Transparent; `fg-success-strong` icon | Transparent; `fg-warning` icon | Transparent; `heading` icon |
| Hover | `brand-soft` background | `danger-medium` background | `success-medium` background | `warning-medium` background | `neutral-tertiary-medium` background |
| Focus | 2px ring `brand-medium` | 2px ring `danger-medium` | 2px ring `success-medium` | 2px ring `warning-medium` | 2px ring `neutral-tertiary` |

Focus ring offset: 0–2px outside the 32px hit target. Shape follows `radius-md`.

### Top accent

A **4px top bar** in the intent border color instead of a full outline, static or dismissible. Background and typography match default — use it for page-level notices that need scan value without a full border.

### Additional content (expanded)

A filled, borderless shell (the intent's soft fill separates it). **Header row:** icon + title + dismiss (space-between). **Body block:** `spacing-2` below the header, `spacing-4` above an optional action. **Action:** a primary button per the button spec (`font-size-xs`, compact padding) using the intent's solid fill (`brand`, `danger`, `success`, `warning`, or neutral dark-soft for the neutral intent).

The title slot uses the same `font-size-sm` / `font-weight-medium` as every other alert — not the page heading scale.

### Announcement (inline)

An inline-flex, content-width row — rounded like every other alert.

| Part | Spec |
|---|---|
| Root padding | `spacing-1` all sides; `spacing-2` padding-inline-end |
| Badge | Intent medium/soft fill; `font-size-sm`; `font-weight-medium`; `radius-xxl` (24px, rounded); padding `spacing-0-5` vertical, `spacing-2` horizontal |
| Message gap after badge | `spacing-2` |
| Trailing chevron | 16 × 16px; `spacing-1` margin inline-start; inherits foreground |
| Border | 1px intent border |
| Background | Intent soft background (same as block alerts) |

Badge fill per intent:

| Intent | Badge background | Badge text |
|---|---|---|
| Info | `brand-soft` | `fg-brand-strong` |
| Danger | `danger-medium` | `fg-danger-strong` |
| Success | `success-medium` | `fg-success-strong` |
| Warning | `warning-medium` | `fg-warning` |
| Neutral | `neutral-quaternary` | `heading` |

The whole row may act as a link — cursor and hover follow the product's link/button rules.

---

## Motion

| Transition | Duration | Properties |
|---|---|---|
| Dismiss fade | 300ms | Opacity |
| Dismiss timing | ease-out | — |
| Hover on dismiss / links | 150ms | Background color, underline |

On dismiss, remove from the DOM or hide visually once the animation completes, then fire any callback. Respect **reduced-motion**: skip the fade — hide immediately or step opacity only.

---

## Accessibility

| Requirement | Spec |
|---|---|
| Role | `role="alert"` on root for important, time-sensitive messages; `role="status"` for passive info if appropriate |
| Live region | Critical errors may use `aria-live="assertive"`; informational alerts use `aria-live="polite"` or static role only |
| Dismiss | `aria-label="Close"` or `"Dismiss"` on dismiss control; visible text not required |
| Icon | `aria-hidden="true"` on decorative icons |
| Hidden intent | Visually hidden text naming intent when icon-only lead |
| Focus | Dismiss control must be keyboard focusable; focus ring per table above |
| Color | Never rely on color alone — icon or text must convey intent |

---

## Stacking & placement

| Rule | Value |
|---|---|
| Vertical gap between alerts | `spacing-4` |
| Max width | 100% of content column — no arbitrary max unless layout spec defines one |
| Inside forms | Full width above or below the field group it describes |
| Inside cards | Inset by card content padding — do not bleed past card inner edge |
| With page headings | `spacing-4`–`spacing-6` below heading or above form — tighter than section breaks |

Never nest an alert inside another alert.

---

## States reference

| State | Visual change |
|---|---|
| Default | Intent background + foreground |
| Hover (dismiss only) | Dismiss background per intent table |
| Focus (dismiss only) | Intent focus ring on dismiss control |
| Dismissed | Removed or hidden — no ghost placeholder |
| Disabled | Not applicable — alerts are read-only containers |

Links inside alerts follow standard link hover (underline toggle); the alert shell itself has no hover state.

---

## Prohibited

- **No toast behavior** — alerts persist; they auto-dismiss only when product logic explicitly removes them.
- **No wrong intent colors** — danger copy on a success fill breaks trust and accessibility.
- **No multiple intents in one root** — split mixed messages into separate alerts.
- **No shadow on alert roots** — `elevation-none`, except this file's action-button exception.
- **No off-scale radius** — every alert, block or announcement, is rounded (`radius-xxl`, 24px); nothing rounds.
- **No heading scale inside alerts** — stay at `font-size-sm`; page titles live outside the alert.
- **No nested alerts** — one root per message block.
- **No dismiss control without keyboard support** — an icon-only close stays focusable and labeled.
- **No brand foreground for long paragraphs** — body copy uses intent foreground or `body`; brand text tokens are for links and short emphasis only (per `colors.md`).
- **No raw hex, px, or rem** and **no framework/vendor class names** — foundation tokens only.
