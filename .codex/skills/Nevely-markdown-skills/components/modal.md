# Modal — TypeUI · Astra

> **TypeUI · Astra** — focused dialogs over a dimmed page.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`, `buttons.md`, `input-field.md`

A modal interrupts the flow for a confirmation, a form, or critical information — used sparingly, since most tasks belong inline or in a drawer. The Astra panel is a clean `neutral-primary-soft` surface with the signature **rounded** (`radius-xxl`, 24px) corners — **flat** (`elevation-none`) with a **visible `default-medium` (`#3A2C57`) border**, reading clearly as a lighter, bordered panel above a 50% scrim. Structure is consistent: a header with title + close divided by a hairline functional rule, a scrolling body, and a footer (same hairline divider) that holds one primary action beside a secondary.

---

## Anatomy

| Part | Role |
|---|---|
| **Backdrop** | Scrim over page |
| **Viewport** | Full-screen flex centering layer |
| **Panel** | Dialog surface |
| **Header** | Title + close control |
| **Body** | Scrollable content |
| **Footer** | Primary/secondary actions |
| **Trigger** | External control opening modal |

---

## Layout

| Property | Token / value |
|---|---|
| Backdrop | `rgba(0,0,0,0.5)` scrim or documented overlay token |
| Panel background | `neutral-primary-soft` (lighter panel over the scrim) |
| Panel border | **1px `default-medium` (`#3A2C57`)** — a visible edge so the panel reads against the dark backdrop |
| Panel radius | `radius-xxl` |
| Panel shadow | None (`elevation-none`) — the **border + scrim** provide separation |
| Panel padding | `spacing-4` mobile; `spacing-6` wide |
| Viewport padding | `spacing-4` around panel |
| Header padding bottom | `spacing-4`–`spacing-5` |
| Header border bottom | 1px `default` |
| Body vertical padding | `spacing-4`–`spacing-6` |
| Body gap between blocks | `spacing-4`–`spacing-6` |
| Footer padding top | `spacing-4`–`spacing-5` |
| Footer border top | 1px `default` |
| Footer button gap | `spacing-4` |
| Max height | Viewport minus margin; body scrolls |

### Close control

**24 × 24px max** — the close (×) button is capped at 24 × 24px in modals; icon 20px; hover `neutral-tertiary`; radius `radius-md`; in the header's trailing corner, or absolute on compact dialogs.

### Title

font-size-lg, font-weight-medium, `heading`.

### Body text

font-size-sm, line-height-body, `body`.

---

## Sizes

| Size | Max width |
|---|---|
| Small | 448px (`spacing-112` scale ~28rem) |
| Default | 512px |
| Large | 896px |
| Extra large | 1280px |

Full width on mobile, minus the viewport padding.

---

## Placement

Default: centered both axes. Optional placements — top-left, top-center, top-right, center-*, bottom-* — anchor the panel to a viewport zone but keep the backdrop unless the dialog is headless.

---

## Variants

### Default

Header + body paragraphs + footer with a primary (`brand`) and secondary (`secondary` button) action.

### Static backdrop

An outside click does **not** close it — the user must choose an explicit action or the close control. For consent, destructive confirms, required surveys.

### Pop-up / confirm

A compact (small) panel with an optional centered 48px icon (`fg-disabled` or intent color), the question in `font-size-sm` `body`, and horizontally centered footer buttons — the destructive "yes" may take a **danger** fill. Close sits absolute top-trailing.

### Form

Header title; a body of stacked fields (`input-field.md`); footer submit primary + cancel secondary. Enter submits when valid.

### CRUD

Create/edit an entity — form layout plus a "Save" primary.

### With radio / option list

The body lists mutually exclusive choices before a confirm.

### With timeline / progress

The body embeds a timeline or progress component — scroll if long.

### Wallet / provider picker

A list of large clickable rows: padding `spacing-4`, `default-medium` border, **`radius-xxl`**, hover `brand-softer` + `fg-brand`. Provider logos are isolated — their colors may be vendor-specific.

---

## Behavior

| Behavior | Spec |
|---|---|
| Open | Fade backdrop 300ms; panel scale/opacity optional |
| Close | Escape, close button, optional backdrop click |
| Focus | Trap inside panel while open; restore to trigger |
| Scroll | Body scrolls; page scroll locked behind backdrop |

Respect **reduced-motion**: instant show/hide.

---

## Accessibility

- Panel: `role="dialog"`, `aria-modal="true"`.
- Label: `aria-labelledby` → title id; `aria-describedby` → body if needed.
- Trigger: `aria-expanded`, `aria-controls`.
- Initial focus: first focusable or primary action — not forced onto the title if the form has an error.
- Destructive confirm: focus **cancel** or the neutral option by default.

---

## Prohibited

- **No panel border or shadow** — the panel is flat (`elevation-none`); it reads above the backdrop through the scrim and its lighter surface, never below `radius-xxl`.
- **No nested modals** — close the parent first.
- **No modal for non-critical read-only content** — use a page or drawer.
- **No auto-open modals on page load** without a user gesture (cookie/legal once excepted).
- **No more than two footer actions** in a default confirm — extra actions move into the body.
- **No heading scale above `font-size-lg`** in the title.
- **No raw hex** (except the documented backdrop alpha) and **no framework data attributes** — semantic tokens only.
