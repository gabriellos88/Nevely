# Cards — TypeUI · Astra

> **TypeUI · Astra** — the system's primary content surface.
> Depends on: `colors.md`, `radius.md`, `shadows.md`, `spacing.md`, `typography.md`, `buttons.md`, `tabs.md`

The card is the face of Astra: a **raised** panel carrying a subtle top-down **gradient** in the system's own violet-blacks — `neutral-primary-soft` (`#0F0720`) easing into `neutral-primary` (`#0A0118`) over the `#000000` page — finished with a faint `brand`-tinted sheen at the top edge, a subtle **`default` (`#281C40`) border**, the signature **rounded** (`radius-xxl`, 24px) corners, and generous `spacing-6` padding. Its **signature move is a subtle, animated border light-up**: the resting gradient stays put, but on hover the hairline border eases to `brand` violet and a soft glow gently breathes around it — quiet and refined, never shouty. At rest it lets its content lead; on hover it comes alive just enough.

---

## Anatomy

| Part | Role |
|---|---|
| **Root** | Bordered, rounded surface |
| **Media** | Optional top or side image |
| **Header** | Title + optional meta |
| **Body** | Description, lists, form fields |
| **Footer** | Actions, links, meta row |
| **Badge / tag** | Optional status label |
| **Tabs** | Optional nav tabs in header (see `tabs.md`) |

---

## Layout

| Property | Token / value |
|---|---|
| Background | Subtle gradient `neutral-primary-soft` (`#0F0720`) → `neutral-primary` (`#0A0118`), with a faint `brand`-tinted (`brand-softer`) sheen at the top |
| Border | `default` (`#281C40`), 1px at rest — **lights up to `brand` on hover** |
| Radius | `radius-xxl` (24px, rounded) |
| Glow | None at rest; soft `brand` glow on hover (see **Shadow & elevation**) |
| Padding (default) | `spacing-6` |
| Max width | Content-driven (~384px for demo cards); full width in grids |
| Gap title ↔ body | `spacing-3` |
| Gap body ↔ footer actions | `spacing-6` |
| Gap between footer buttons | `spacing-4` |
| Hover (clickable card) | **Subtle light-up:** border eases to `brand` with a soft, animated breathing glow in `brand-soft`; the gradient surface stays put (see **Shadow & elevation**) |

### Horizontal card

Media column ~40% width; body column padded `spacing-6`; stacks vertically below the tablet breakpoint.

### Image top

Media bleeds to the top edge; its top corners follow the root `radius-xxl` and its bottom edge sits square against the body.

---

## Typography

Card titles stay quiet — `font-size-2xl` is the ceiling inside a standard card. Display type belongs to the page, not the card.

| Element | Size | Weight | Line height | Color |
|---|---|---|---|---|
| Card title | font-size-2xl | font-weight-semibold | line-height-heading | `heading` |
| Card subtitle / meta | font-size-sm | font-weight-normal | line-height-body | `body-subtle` |
| Body | font-size-sm | font-weight-normal | line-height-body | `body` |
| Footer link | font-size-sm | font-weight-medium | line-height-body | `fg-brand` |
| Price / stat emphasis | font-size-xl | font-weight-bold | line-height-heading | `heading` |

---

## Variants

Every variant is the same shell — raised, shadowless, a step lighter than the page, rounded corners — rearranged around its content.

### Default

Title + body; the whole card may be a single link.

### With button

Body plus a primary button (`buttons.md` base size) in the footer; an optional trailing icon on the button.

### With text link

The CTA is an `fg-brand` underlined link instead of a button — for lower-stakes follow-through.

### With image

Image above or beside the content; outer-edge radius rules still apply.

### With description only

Longer body copy at the same padding.

### Horizontal

Side-image layout for lists and featured entries.

### User profile

A circular avatar (64–96px) centered above the name, then role, a stats row, and action buttons; an optional dropdown menu in the corner.

### With form

Stacked inputs in the body and a submit button in the footer; field spacing `spacing-4`–`spacing-5`.

### E-commerce

Image, title, price, rating, add-to-cart — the price row uses the stat typography.

### Call to action

Centered copy and a single primary button; emphasis comes from a `brand` border over the raised panel, not a fill change.

### With tabs

A tab strip in the header with panel content below; the tab model is delegated to `tabs.md`.

### With list

Icon + text rows in the body; list item padding `spacing-2`–`spacing-3`.

### Pricing

Tier name, price, feature list, and CTA — the highlighted tier is marked by a `brand` border (in place of the default `#281C40`) over the same raised panel.

### Testimonial

Quote body, avatar, and author name — the quote may step up to `font-size-md`.

### Crypto / stats

A large metric, a delta badge, and a sparkline area — the badge follows `badges.md`.

### Composite / glued grid

Several regions sitting **flush in one grid**, separated only by hairline rules rather than free space (a feature matrix, comparison grid, or any flush multi-cell panel), are **one composite card — not many cards glued together**.

**The grid element is the card.** It — and only it — carries the raised `gradient-card` fill, the top-lit fading `default` (`#281C40`) border, the `radius-xxl` (24px) corners with `overflow: hidden`, the dust grain, and (marketing only) the corner hover glow + outer bloom. Never wrap it in a second "frame" element; one element owns the surface.

**Inner cells are fully transparent.** They lay content over the shared fill and never carry their own `gradient-card` background, border, radius, or grain layer — repeating the panel fill per cell reads as separate tiles and is prohibited.

**Dividers are cell borders, never a painted gutter behind transparent cells.** The classic trap is `gap: 1px` + a flat `default` (`#281C40`) `background` on the grid with `background: transparent` cells: since transparent cells sit *on top of* the grid, they show that **flat `#281C40` gutter colour across the whole cell** instead of the `gradient-card` fill, so every cell reads as a separate flat tile with the wrong background. Instead:

- Grid: `gap: 0`, `background: gradient-card` (padding-box) + top-lit fading `default` border (border-box), `border-radius: radius-xxl`, `overflow: hidden`.
- Cells: `background: transparent`; draw hairlines as **1px `default` borders on the cells** — `border-top` between rows, `border-right` between columns, resetting the trailing edges at each breakpoint so the outer frame border is never doubled.

On marketing, hovering any cell lights the **shared surface** via `:has(.cell:hover)` on the grid/card — never a second mini-card inside the cell. On dashboard / application surfaces the composite panel stays flat (no dust, no hover glow) per the app-surface rules.

### Bento / decorative visual

A bento or feature card whose top holds a **signature decorative visual** — a pill-toggle, connected integration nodes, a radiating pulse core, and the like — above the title and body. The visual is **built in astra's own palette from CSS + inline SVG**, never an off-theme (warm / light) raster image.

**Stage.** The visual lives in its own inset **stage**: a `radius-md` (16px) block over the card's `#0A0118` fill, backed by a **faint violet dot-grain** (`radial-gradient` dot pattern in `default-medium` `#3A2C57`, ~0.55 opacity, ~18px cells) that **fades to nothing via a radial `mask-image`** so the pattern never hits the stage edges. Mark the stage `aria-hidden` — it is decoration; the card's heading + body carry the meaning. Leave the card's own dust grain and corner hover glow to the card (the visual's layers sit above the dust, below the content) and never reflow the visual on hover.

**Palette.** Astra violets only: fills run `brand` / `brand-soft` → `neutral-primary`; edges are `default` / `brand-subtle`; glow is `brand` / `brand-medium` (`#713DFF` / `#8B5CFF`) at low opacity. No off-token hues.

**Signature construction (stack-agnostic):**

- **Nested rings** — stacked `0 0 0 Npx` `box-shadow`s on a `radius-full` element, so the rings follow the pill / circle shape. Never build rings as extra DOM elements.
- **Integrations = hub-and-orbit** (the preferred "connect your stack" layout — not a cramped row of tiles): a **square stage** holding a centred, glowing **brand hub** (filled `brand` → `brand-strong` `radius-md` tile, white icon, a `neutral-primary-soft` ring via `box-shadow` + a soft `brand` radial bloom behind it), encircled by **one or two dashed orbit rings** (`radius-full` element, `1px dashed default-strong`, ~0.55–0.8 opacity). **App tiles sit on the orbits** at the cardinal points — each an absolutely-positioned `radius-md` tile pulled onto the ring with `translate(-50%, -50%)`, a `neutral-primary` fill, `default` border, and a faint brand glow. One orbit slot is the **"+N More" pill**. The rings read as the connective tissue, so no separate connector lines are needed.
- **Hexagon tiles** (optional honeycomb motif) — a `clip-path` polygon (`polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)`) with a **2px-inset `::before`** for the inner fill, and a **`filter: drop-shadow(… brand …)`** for a glow that hugs the shape (a `box-shadow` can't escape a `clip-path`).
- **Connectors** (when nodes are not on orbit rings) — dashed SVG arc `path`s stroked in `fg-brand` with `stroke-dasharray`, at ~0.3–0.5 opacity, behind the nodes.
- **Label pill** (e.g. `+N More`) — a `radius-full` chip with a subtle `brand` glow.

**Marketing only.** Like all card grain and hover glow, decorative bento visuals are a landing-page flourish — **never on dashboard / application** cards, which stay flat and data-first.

---

## Shadow & elevation

Cards separate by a **gradient raised surface** plus the `default` (`#281C40`) border. There is no resting drop shadow — depth is the gradient and border at rest, and on hover the **border gently lights up to `brand` with a soft, animated glow**.

| State | Surface |
|---|---|
| Resting | Gradient `neutral-primary-soft` → `neutral-primary` over `#000000` + faint `brand-softer` top sheen + `default` border; no glow |
| Hover (interactive) | Border eases to `brand` with a **subtle breathing glow** in `brand-soft`; the gradient surface stays as-is |
| Inset card (inside another card) | A tone between the parent panel and the page, with its own `default` border, so it reads recessed |

### Signature interaction — subtle animated border light-up

The card's defining move is **quiet**: the resting gradient never changes, but on hover the hairline **border eases from `default` to `brand`** and a **soft glow gently breathes** around it (a slow pulse), so the card feels alive without shouting. The rule is **stack-agnostic** — it names which token feeds each value, so it builds with plain CSS, a CSS-in-JS layer, a utility framework, or any renderer.

**Token sourcing (never hard-coded):**

| Aspect | Source |
|---|---|
| Resting surface | gradient `neutral-primary-soft` → `neutral-primary` + `brand-softer` top sheen (unchanged on hover) — `colors.md` |
| Resting border | `default` (`#281C40`), 1px — `colors.md` |
| Hover border | eases to `brand` (`#713DFF`) — `colors.md` |
| Hover glow | a **subtle, animated** breathing glow in `brand-soft` (small radius, low intensity) — `colors.md` |
| Corner radius | `radius-xxl` (24px) — `radius.md` |
| Padding | `spacing-6` — `spacing.md` |
| Border transition | ~0.3s ease |
| Glow animation | slow ~2.4s `ease-in-out` loop while hovered |

**Reference implementation** (illustrative only — every literal must resolve to the tokens above):

```css
/* Gradient card with a subtle, animated border light-up on hover */
.card {
  padding: var(--spacing-6);
  border: 1px solid var(--default);                 /* #281C40 */
  border-radius: var(--radius-xxl);                  /* 24px */
  color: var(--body);
  /* faint brand sheen at the top, over a neutral violet-black gradient — stays on hover */
  background:
    radial-gradient(120% 80% at 50% 0%, var(--brand-softer) 0%, transparent 60%),
    linear-gradient(180deg, var(--neutral-primary-soft) 0%, var(--neutral-primary) 100%);
  transition: border-color 0.3s ease;
}

.card:hover {
  border-color: var(--brand);                        /* border lights up */
  animation: cardBorderGlow 2.4s ease-in-out infinite; /* gentle breathing glow */
}

/* subtle, quiet pulse — small radius, low intensity */
@keyframes cardBorderGlow {
  0%, 100% { box-shadow: 0 0 0 1px var(--brand-subtle), 0 0 6px var(--brand-soft); }
  50%      { box-shadow: 0 0 0 1px var(--brand),         0 0 14px var(--brand-soft); }
}
```

Honor `prefers-reduced-motion` by dropping the breathing animation — keep a single static `brand` border with a faint, fixed `brand-soft` glow.

---

## Accessibility

- A clickable whole card is one link wrapping the card **or** a heading link plus distinct buttons — never nested interactive elements.
- Images carry meaningful `alt`, or `alt=""` when decorative.
- Tab cards follow the keyboard model in `tabs.md`.

---

## Prohibited

- **No corners other than `radius-xxl`** (24px, rounded) and no raw hex — a card with square or hard corners isn't an Astra card.
- **No resting drop shadow** — at rest a card carries no shadow; the only depth effect is the **subtle, animated `brand-soft` glow on hover**. Do not add unrelated multi-layer float shadows.
- **No borderless cards** — every card carries the hairline `default` (`#281C40`) border; do not drop it and rely on a shadow.
- **No flat card flush with the page** — a card is a *raised* panel (`neutral-primary`, `#0A0118`) a step lighter than the page, plus the `default` (`#281C40`) border; never the same tone as the page and never a heavy shadow. Emphasis uses a `brand` border.
- **No off-token or heavy borders** — at rest the border is the hairline `default` (`#281C40`) at 1px; on hover it lights up to `brand`, and a status card may use an intent edge. Do not thicken it beyond ~1px or use colors outside the token set.
- **No gradient outside the system palette** — the surface gradient runs `neutral-primary-soft` → `neutral-primary` with a `brand-softer`/`brand-soft` sheen; never rainbow or off-token gradient stops.
- **No full-width hero typography inside default cards** — that lives in the page section, not the card.
- **No per-cell surface in a composite / glued grid** — inner cells never carry their own `gradient-card` fill, border, radius, or grain; the grid element alone owns the surface (see **Variants → Composite / glued grid**).
- **No flat gutter behind transparent cells** — never `gap: 1px` + a flat `default` (`#281C40`) `background` on the grid with transparent cells; the cells show the flat gutter colour, not the shared `gradient-card` fill, and read as separate tiles. Use `gap: 0` and draw dividers as 1px cell borders instead.
- **No two competing primary CTAs** without hierarchy (one filled, one link).
- **No framework class names** in specs.

---

## Card treatments — signature astra styling

> Moved here from `SKILL.md` (the authoritative card visual rules). These are astra-specific; marketing/landing only where noted, never on dashboard / application surfaces.

- **Card "dust" grain texture.** Astra cards and raised panels (`#0A0118`) carry a **subtle noise / film-grain "dust" texture** over their fill — the fine speckle premium dark UIs use to keep large flat panels from looking dead. Implement it as an **SVG fractal-noise overlay**, not hand-placed dots: an `feTurbulence` filter — `type="fractalNoise"`, `baseFrequency ≈ 0.8`, `numOctaves 3–4`, `stitchTiles="stitch"` — followed by an **`feColorMatrix type="saturate" values="0"`** to strip color to pure grayscale grain, rendered to a tiling data-URI and layered on top of the panel fill (a `::before` clipped to the card's `radius-xxl` (24px) corners with `border-radius: inherit`), **below the content** (grain at `z-index: 1`, card children at `z-index: 2`). Because the panel is near-black, the noise must **lighten to read** — use **`mix-blend-mode: screen`** (not `overlay` / `soft-light`, which vanish on `#0A0118`). Put a **rect `opacity="0.7"` inside the SVG** for a denser speckle, then hold the overlay layer at **~10% opacity** (`--card-dust-opacity: 0.1`) with **`background-size: 200px 200px`** so the tile reads as texture, **never as visible dots or an overall lightened tint**. It changes nothing structural — the `#281C40` border, padding, and layout stay as-is; if the grain shouts at a glance, it's too strong (dial the overlay opacity down, not off). Working recipe (as shipped): overlay `background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.7'/%3E%3C/svg%3E"); background-size: 200px 200px; mix-blend-mode: screen; opacity: 0.1;`. This is a **marketing / landing-page flourish only** — **never apply it to dashboard / application surfaces**: any in-product / app page, section, widget, card, table, or component keeps a **clean, flat `#0A0118` panel with no grain**, for density and legibility.
- **Cards have a top-lit, fading border.** An astra card's border is **not a uniform hairline** — it's a **vertical gradient that is most visible along the top edge and fades away toward the bottom**, as if the card is lit from above. Run the border colour from the `default` violet edge (`#281C40`, or a touch brighter — up to ~`#453564`) at the **top** down to **fully transparent** at the **bottom**, so the lower border quietly disappears into the `#000000` surface; the left/right edges carry the same top→bottom fade. Implement with a gradient border, e.g. `border: 1px solid transparent; background: linear-gradient(#0A0118, #0A0118) padding-box, linear-gradient(180deg, #281C40, transparent) border-box;` (or `border-image: linear-gradient(180deg, #281C40, transparent) 1`). The fill (`#0A0118`) and radius (`radius-xxl`, 24px) are unchanged — only the border's opacity gradient does the work. Only inputs and badges opt out of this fading border.
- **Glued grid / composite card panels — one surface, many cells.** When several regions sit **flush in one grid** — cells separated only by **hairline rules**, not free space between independent cards (e.g. a feature matrix, comparison grid, or any flush panel) — they are **one composite card**, not many cards stacked together. **The grid element itself is the card**: it carries the raised `gradient-card` fill, the top-lit fading `default` border, the `radius-xxl` (24px) corners with `overflow: hidden`, the dust grain, and (marketing only) the corner-anchored hover glow and outer bloom. Do **not** wrap it in a second "frame" element — one element owns the surface. **Inner cells must be transparent** over that shared fill — **never** each their own `gradient-card` background, border, or grain layer; repeating the panel fill per cell reads as separate tiles glued together and is prohibited.
  - **Dividers are cell borders, never a painted gutter behind transparent cells.** The classic trap: setting `gap: 1px` + a flat `default` (`#281C40`) `background` on the grid, then making cells `background: transparent`. Because transparent cells sit **on top of** the grid, they don't reveal the grid's `gradient-card` fill — they reveal that **flat `#281C40` gutter colour across the whole cell**, so every cell reads as a separate flat tile with the wrong background. **Prohibited.** Instead: give the grid `gap: 0` and draw the hairlines as **1px `default` borders on the cells** (`border-top` between rows, `border-right` between columns, reset at row/column ends per breakpoint). The cells stay fully transparent and the one `gradient-card` fill + dust show through every cell as a single continuous surface. (If you must use `gap`, the gutter background has to be the **same fill as the frame**, not a flat brighter colour — but cell borders are the reliable pattern.)
  - The hairline rules use the `default` (`#281C40`) colour purely as **functional dividers** — never a brighter step than the frame border. On marketing, hovering a cell lights the **shared surface** (e.g. `:has(.cell:hover)` on the grid/card), not a second mini-card inside the cell.
- **Card hover: a small mouse-tracking edge glow lights the card's edges near the cursor — the border never changes (marketing only).** On hover a **small, dark** glow follows the mouse but is **confined to a thin band along the card's edges** — it lights the **perimeter nearest the pointer**, not a spotlight under the cursor and never a bloom across the card's face (that strains the eyes). **The border itself does not participate at all.** The static border stays exactly its resting top-lit fade in **every state — rest, hover, focus, active, and click**: no glow, no second / extra ring, no recolour, no thicken, and **no pulse**. Only this soft edge light moves; the content never moves. Build it with a single layer:
  - **Track the pointer.** The card is `position: relative; isolation: isolate; overflow: hidden;` and exposes two custom properties `--mx` / `--my`, updated on `mousemove` to the pointer's position inside the card; the glow layer is centred on `(--mx, --my)`. Ease the *position* — a short `transition` (~120–200ms) on the glow's `transform` / centre — so the light **trails the cursor smoothly instead of snapping**, and fade it out on `mouseleave`.
  - **Edge glow only — small, dark, masked to the perimeter.** One cursor-centred radial glow sits over the card fill (below the content) but is **masked to a ~1.5px band along the card's edges** so it lights only the perimeter near the pointer. Make it **clearly visible but confined to the edge**: a **~200px** `radial-gradient` of the luminous `brand-medium` (`#8B5CFF`) fading to transparent by ~72%, held to a **~2.5px edge band** by a border-mask (`padding: 2.5px; mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); mask-composite: exclude;`), `opacity: 0 → ~0.9` on hover with `transition: opacity 300ms ease`. It must **read clearly as a light travelling the card's edges** — brightness is fine here precisely *because* it's a thin perimeter band and never fills the interior (a full-card spotlight is what strained the eyes, not a bright edge). **No big central bloom, no `box-shadow` outline, no inset `::before` ring** — a central spotlight or a full ring is exactly what strains the eyes / reads as a phantom border, and is prohibited. **No surface bloom on the card face** — the glow lives *only* on the edge band; the interior of the card never lightens.
  - **The border is inert — never touch it on interaction.** No hover / focus / active / click rule may change the border: no `border-color` change, no `border-image` swap, no `box-shadow: inset`, no second gradient ring, no scale, and **no pulse or animation on `:active` / click**. The border is 100% the resting top-lit fade, always. If the border lights up, thickens, doubles, or pulses, a stray border/active rule leaked in — remove it.
  - **Content is untouched.** Title, body, and icons get **no `transform`, shift, reflow, or size / padding / border change** on hover, active, or click — *only the single background glow's opacity and position change*.
  - Astra colours only (glow `brand` / `brand-medium` `#713DFF` / `#8B5CFF`, panel `#0A0118`, resting border top-lit `default #281C40` → transparent); honour `prefers-reduced-motion` (skip the travel + fade). **Marketing / landing cards only — never on dashboard / application** cards, sections, widgets, or components (those keep a plain static border, no hover glow). **Also never on a table** — a data or pricing / comparison table (and its scroll wrapper) is exempt even on a marketing page: it gets **no pointer-tracking edge glow and no breathing-border hover**, only the row hover tint from `tables.md`. Reserve this hover glow for genuine cards / composite card panels, not tabular surfaces.
- **A badge / label anchored to a card's top must stay fully inside the card — never straddle the edge, because the card clips (`overflow: hidden`).** A marketing card owns its surface with `overflow: hidden` (for the dust grain and the `radius-xxl` border clip). So a "Recommended" / "Most popular" pill (or any top-anchored badge) that is absolutely positioned **must sit entirely within the card's top area** — do **not** pull it half-outside the top border with a `translateY(-50%)`, because `overflow: hidden` will **crop the half that sticks out**. Position it fully inside: `position: absolute; top: <spacing>; left: 50%; transform: translateX(-50%)` (no negative Y translate), and give the card **extra top padding** so its heading clears the badge. If a design truly needs a badge straddling the border, that specific card must drop `overflow: hidden` (and therefore forgo the clipped grain) — but the default and preferred pattern is **badge fully inside a clipped card**. Also remember `.marketing-page .card > *` forces `position: relative` on direct children, so scope the absolute badge rule under `.marketing-page` (or raise specificity) or it will fall back into normal flow and stretch full-width.
- **Bento decorative visuals — built in-palette, never off-theme raster art (marketing only).** A bento / feature card may carry a **signature decorative visual** in its upper "stage" (a pill-toggle, connected integration nodes, a radiating pulse core, etc.) above its title + body. Build these **entirely from CSS + inline SVG in astra's own dark-violet palette** — never drop in a warm/light or off-brand raster image. The visual sits on its own stage inside the card: a `radius-md` (16px) inset block over the card's `#0A0118` fill, backed by a **faint violet dot-grain** (a `radial-gradient` dot pattern in `default-medium` `#3A2C57` at ~0.55 opacity, `~18px` cells) that **fades out via a radial `mask-image`** so it never meets the stage edges as a hard pattern. Every lit element uses astra violets only — fills run `brand`/`brand-soft` → `neutral-primary`, edges are `default`/`brand-subtle`, and glow is `brand`/`brand-medium` (`#713DFF` / `#8B5CFF`) at low opacity. Signature moves, all stack-agnostic: **nested "rings"** are drawn as stacked `0 0 0 Npx` `box-shadow`s on a `radius-full` element (they follow the pill/circle shape — never real extra DOM rings); an **integrations / "connect your stack" visual** is a **hub-and-orbit**, not a cramped row of tiles — a single glowing **brand hub** (a filled `brand`→`brand-strong` `radius-md` tile with a white icon, a `neutral-primary-soft` ring + brand bloom) centred in a **square stage**, encircled by **1–2 dashed orbit rings** (a `radius-full` element with a `1px dashed default-strong` border at ~0.55–0.8 opacity), with **app tiles positioned on the orbits** at the cardinal points (each an absolutely-placed `radius-md` tile `translate(-50%,-50%)` onto the ring, `neutral-primary` fill, `default` border, faint brand glow) and a **"+N More" pill** occupying one orbit slot; a soft radial `brand` bloom sits behind the hub. Prefer this orbit layout over hexagon rows for integration ecosystems. (Hexagon tiles remain available where a honeycomb motif is wanted: a `clip-path` polygon with a 2px-inset `::before` for the inner fill and a `filter: drop-shadow(... brand ...)` for a shape-hugging glow — a `box-shadow` won't show past a `clip-path`.) A **"+N More" / label pill** is a `radius-full` chip with a subtle brand glow. The stage is **decorative** — mark it `aria-hidden` and keep the real meaning in the card's heading + body. It inherits the card's marketing dust + corner hover glow (the card owns those); the visual's own layers sit **above the dust, below the content** and **never animate the layout** on hover. Like all card grain/glow, this is **marketing / landing only — never on dashboard or application** cards, which stay flat and data-first.
