---
name: "nevely-markdown-skills"
description: "Nevely design skill for AI coding agents."
metadata:
  author: typeui.sh
  source: workspace-importer
  projectName: "Untitled Project 2"
  projectLogoUrl: ""
  importSource: "Manual TypeUI setup"
  primaryColorReference: "#18181b"
  surfaceColorReference: "#ffffff"
  textColorReference: "#09090b"
  typographyScale: "Inter-style sans serif, 12/14/16/20/24/32 scale, medium labels, semibold headings."
  spacingScale: "4px base grid with 8px, 12px, 16px, 24px, and 32px layout steps."
  radiusScale: "6px controls, 8px cards, 12px overlays, nested radii reduced by inner padding."
---

# TypeUI · Astra — Design System

> **⚠️ READ FIRST — NON-NEGOTIABLE.** Do **not** design, build, or write any component, section, or page until you have **carefully read every `.md` file in this directory**. Read them all first, *then* consciously decide what to create — only after that may you build components, sections, and pages. There are no exceptions.

This skill is the **authoritative visual specification for TypeUI "Astra"** (from [typeui.sh](https://www.typeui.sh)). Everything you build for this project — every component, layout, and page — follows the module files bundled here. They define *what Astra looks like* down to the token; you decide how to implement it (plain CSS, utility classes, CSS-in-JS, any renderer), but you implement this design — you do not redesign it.

**The canonical specs are the `*.md` files in this directory.** Read the full module before you write UI for it. A nested skill folder may ship short summaries; those are wayfinding only and link back to these files.

---

## What Astra is

Astra is a **polished, production-grade component system**, expressed as **stack-agnostic design tokens**. Its character is dark, modern, and quietly premium: a near-black content surface (`#000000`) with raised violet-black panels (`#0A0118`), a vivid **violet** brand (`#713DFF`) that often reads as a gradient glow, **pill-shaped controls** with **24px rounded panels**, and light text (white headings over muted lavender-gray body). The result should feel *deep and luminous* — never flat-white, never harsh. If a screen built from these modules reads as light, square, or hard-edged, it isn't Astra yet.

### Signature traits — non-negotiable

These are what make a screen recognizably Astra. Hold every one of them, on every surface:

- **Pill buttons + 24px panels** (`radius.md`) — buttons and badges are fully rounded (`radius-full`); inputs, cards, modals, menus, alerts, tabs, tables, and tooltips are `radius-xxl` (24px). This pairing is the defining trait.
- **Functionally round controls** (`radius-full`, 999px) — the toggle track, avatars, radio, range, status dots stay fully round.
- **Inter V on a compact scale** — a 14px (`font-size-sm`) **control** baseline under a disciplined heading ramp, so UIs read clean, modern, and competent. **Page body / reading copy holds a 16px floor** (only badges and micro-elements go below it — see operating rules). See `typography.md`.
- **Dark surface + a violet brand** — the page is a near-black surface (`neutral-secondary-soft`, `#000000`); cards sit on a *raised* violet-black panel (`neutral-primary`, `#0A0118`) outlined by a subtle `#281C40` border; `brand` (violet `#713DFF`, solid fill with `white` label) leads primary actions while `fg-brand` (a lighter violet) carries links; `success` / `danger` / `warning` appear only for real state, never decoration. See `colors.md`.
- **Raised, subtly-bordered surfaces** — separation comes from a raised lighter-violet panel plus the subtle `default` (`#281C40`) border and spacing — never a heavy drop shadow — under a brand focus ring on every interactive element. See `shadows.md`.

---

## How to use this skill

1. **Load the foundation first.** For any UI work, read `colors.md`, `typography.md`, `spacing.md`, `radius.md`, and `shadows.md` before anything else — every component depends on them.
2. **Add a module per element on the page.** A modal form with inputs and buttons means `modal.md` + `input-field.md` + `buttons.md`. Don't write JSX/CSS until the relevant specs are loaded.
3. **Cross-reference.** Components inherit from each other — a search bar satisfies the search section in `input-field.md`; a table footer pulls in `pagination.md`.
4. **Trust these files over memory or external docs.** When this skill and any external or vendor documentation disagree, this skill wins.

### Suggested reading by task

| Task | Read at minimum |
|---|---|
| Landing / marketing page | foundation + `buttons.md`, `cards.md`, `alerts.md` |
| Form page | foundation + `input-field.md` + relevant form modules + `buttons.md` |
| Dashboard | foundation + `tables.md`, `tabs.md`, `dropdowns.md`, `badges.md` |
| Settings | foundation + form modules + `toggle.md`, `checkbox.md`, `radio.md` |
| Overlay / dialog | `modal.md` or `drawer.md` + the content modules inside |

---

## Operating rules

- **Tokens are the vocabulary, and they are agnostic.** `neutral-primary-soft`, `heading`, `default-medium`, `spacing-4`, `radius-xxl`, `elevation-1` are Astra tokens, not framework utilities — map them into your stack's token layer.
- **Hold the signature radius.** Buttons and badges are `radius-full` (pill); inputs and panels (cards, modals, menus) are `radius-xxl` (24px); only functionally round controls (toggle track, avatars, radio, range) also use `radius-full`. Shipping square controls or square panels quietly breaks the theme.
- **Raised and subtly bordered.** No resting card or component wears a heavy drop shadow (floating overlays — dropdowns, menus, popovers — are the one documented exception and carry a real medium shadow; see `dropdowns.md`). A card sits on a *raised* panel (`neutral-primary`, `#0A0118`) a step lighter than the `#000000` page, separated by a subtle `default` (`#281C40`) border. Inputs and other controls use a *contrasting* fill (`neutral-tertiary`, `#1A0F33`) plus that border so they read on the dark surface. Outline buttons carry a 2px border. Primary buttons are solid `brand` pills with the bloom-up hover (see `buttons.md`).
- **Dark surface; violet is an accent, not a section fill.** Content sections share the dark `neutral-secondary-soft` (`#000000`) surface; the violet `brand` (`#713DFF`) is used for controls, links, gradients, and intentional hero/feature glows — never as a full content-section background, and never a third striping color.
- **Equal vertical breathing room between sections.** Every section carries the **same spacing above and below it** — the top padding/margin of a section equals its bottom padding/margin, and the gap between any two adjacent sections is symmetric. No section gets more air on one side than the other; rhythm comes from this consistent, balanced spacing, never from uneven gaps.
- **Section vertical padding is 112px, top and bottom — the hero and the footer are the exceptions.** Every content section carries **`112px` (`spacing-28`, `7rem`) of padding on both the top and the bottom**, applied equally so the section rhythm stays symmetric across the whole page. This is the single, fixed section rhythm — do not drop it to a smaller step on mobile or bump it up per section. The **exceptions are the hero** (which owns its own top/bottom spacing — sticky-nav clearance above, card-fan / lead spacing below) **and the footer** (which uses the asymmetric footer padding rule below). Every other band — feature grids, pricing, FAQ, social proof, CTA — uses the 112px top and bottom.
- **Footer vertical padding is asymmetric: a 96px or 112px top, and a light bottom (≤ half the top).** The footer is the one band that deliberately breaks the symmetric-section rule. Give the footer's inner content block a **top padding of `96px` (`spacing-24`) or `112px` (`spacing-28`)** and a **deliberately light bottom** — **at most half the top** (`48px` / `spacing-12` under a `96px` top, `56px` / `spacing-14` under a `112px` top), and often less. Never make the footer's top and bottom padding equal, and never let the bottom exceed half the top; the lighter base keeps the footer grounded at the very end of the page. This applies to the footer's own padding only — the internal spacing between its bands follows the normal spacing scale.
- **If the footer's last band already carries its own bottom padding, the footer container drops its bottom padding entirely (never double it).** When the final row of the footer — the bottom bar / copyright band, or whatever sits last — already has its **own `padding-bottom`** (e.g. a bottom bar with `padding-block`), the **outer footer container must set its own `padding-bottom` to `0`** so the two don't stack into an oversized gap. Only **one** element owns the footer's bottom spacing: either the container pads the bottom **or** the last band does — never both. So a bottom bar with, say, `spacing-8` of block padding means the container's bottom padding is `0` (the top padding still follows the 96/112px rule above). If the last band has **no** bottom padding of its own, then the container supplies the light bottom padding from the rule above. Audit the real rendered footer: if you see a large empty band below the last row of content, it is almost always this doubled padding — zero one of the two.
- **Foundation values are law.** Never invent a color, size, radius, or shadow that contradicts the foundation files — if no token fits, the foundation file is where a new one gets added.
- **Every interactive element earns its states.** Hover, focus, and disabled are defined in each module; the brand focus ring is never removed without an accessible equivalent.
- **Text contrast at every state — non-negotiable.** Label and background must stay readable together in **default, hover, focus, active, and disabled** — WCAG 2.2 AA minimum. This matters on buttons with animated hovers (e.g. the bloom-up primary: the `brand-medium` fill is only a *lighter step of the same violet*, so the `white` label stays legible throughout — never lighten the bloom to white/`buffer` where a white label would wash out). Verify mid-transition frames, not just rest and fully-hovered endpoints. See `colors.md` → *Contrast, accessibility, and states* and `buttons.md` → *Signature interaction*.
- **Semantic HTML, always.** Proper `h1`→`h6` order, `<button>` for actions, `<a>` for navigation, real labels on form controls, and ARIA where a module calls for it.
- **No vendor leakage.** Describe and implement through tokens; never paste framework or vendor class strings from external docs into the work.
- **Form controls share one shell.** Text-like controls (`input-field`, `select`, `textarea`, …) inherit the field shell in `input-field.md` unless a module explicitly overrides it.
- **Themed form controls.** Checkboxes, radios, and toggles always render in **this theme's own style** — the theme `brand` fill when checked / selected / on, plus the theme's surface, border, radius, and focus-ring tokens — never the native/unstyled browser control and never another theme's colors. **Reset the native input** (`appearance: none`) and draw the control yourself — a native `accent-color` tint alone is **not** enough, it still renders the OS control: build the box / track, the checked `brand` fill, the check / dot / thumb mark, and the focus ring from this theme's tokens. See `checkbox.md`, `radio.md`, `toggle.md`.
- **Checkboxes are always square.** Every checkbox tick box — in forms, tables, filter dropdowns, and menus — is a **16 × 16px square with `radius-none` (0)**. Never round the checkbox with `radius-full`, `radius-xs`, or any other radius; round controls are for **radios** (`radius-full`) and **pills**, not checkboxes. See `checkbox.md` and `radius.md`.
- **Real icon library.** Use a proper icon library — **FontAwesome Free or Lucide** (or an equivalent that fits your stack) — for every UI icon, sized and colored with the theme's tokens, and **use the outline / line style, never solid/filled icons**. Never hand-roll one-off inline SVGs, emoji, or icon-font glyphs for interface icons.
- **Real charts on dashboards.** When building an application, dashboard, or widget with data visualization, render it with a **real charting library** (e.g. Recharts, Chart.js, ECharts, visx, or your stack's equivalent) bound to real data and styled with the theme's color tokens — never a static image, CSS-bar mock, or placeholder graphic.
- **Spacing comes from the fundamentals.** Take every margin, padding, and gap from the scale in `spacing.md` (never ad-hoc px). Always give **headings and paragraphs room above and below**, and **pad both sides of any border, separator, or divider** so content never crowds a rule. See `spacing.md` and `typography.md`.
- **Navbar & footer links are text links, not buttons.** A link in the navbar or footer has **no padding and no background/fill hover** — it is **not** a ghost button. On hover it only **lightens its text color** (a subtle lighter/dimmer text tone) because it is a link, not a button. Reserve padded, background-hover treatments for real buttons and sidebar nav items. Adjacent nav links sit **24px** apart.
- **Section width: max 1280px, centered.** Every section's content sits in a **centered container with a max-width of `1280px`** (equal auto left/right margins). Sections are always horizontally centered — never left/right-aligned or off-center, and never wider than 1280px of content. A full-bleed background may still span the viewport, but the **content is capped at 1280px and centered**.
- **Section header → content gap: at least 64px (margin-bottom).** The **section heading block** — the section heading, plus any lead paragraph and/or buttons that belong with it — is separated from the **rest of the section's content** by a minimum of **64px**. Keep the heading, its paragraph, and its CTA buttons together as one intro block (their own internal gaps follow `typography.md` / `spacing.md`), then leave **≥ 64px** below that whole block before the body content begins.
- **Section header max-width: 768px.** A section header — made up of any combination of an eyebrow, a heading, a supporting paragraph, and/or buttons (whichever the section uses) — is capped at **768px** wide (centered for centered headers, left-aligned within that measure otherwise) so the heading and lead wrap to a comfortable line length instead of stretching the full section width.
- **No decorative dashes or numbering in copy.** Never trail a word or label with a dangling dash flourish (e.g. `platform —`), and never number eyebrows, section labels, steps, or list items with zero-padded or hashed sequences (`01`, `02`, `#1`, `#2`). Eyebrows and headings are plain words: no dash "lines", no decorative counters.
- **No duplicate borders between sections.** Where two adjacent sections (or stacked cards, rows, widgets, list items) share an edge, **only one of them draws that border** — never both. If a section has a bottom border, the next section does **not** also add a top border, so the shared line stays a single hairline, never a doubled 2px line. Pick one direction (e.g. bottom-only) and apply it consistently; the last element omits the trailing edge.
- **Section divider — a center-lit violet hairline, not a flat rule (marketing only).** Between two stacked marketing / landing sections on the flat `#000000` surface, separate them with astra's signature **glowing divider**: a **full-bleed 1px horizontal hairline that is brightest at the centre and fades to fully transparent at both left and right edges**, paired with a **soft, wide violet beam-bloom** centred on the line. It reads as a thin beam of light lying across the page, never a hard grey `1px` border. Build it in astra's palette only: the line is a horizontal `linear-gradient(90deg, transparent → brand → transparent)` running from `transparent` at the edges up to the brighter `brand-medium` (`#8B5CFF`) at the 50% centre; the bloom is a low-opacity (~0.12–0.15) violet `brand` (`#713DFF`) `radial-gradient` in a **wide, short ellipse** (much wider than tall — e.g. a ~`46rem` × `9rem` box) centred on the line, so the glow spreads horizontally like a beam and bleeds a little above and below the seam. Give the divider element `position: relative` with a small positive `z-index` (e.g. `2`) so the bloom paints **above the opaque backgrounds of both neighbouring sections** (otherwise the next section's `#000000` fill clips the lower half of the glow). Keep it subtle — one thin lit line, no thick bars, no second colour, honour `prefers-reduced-motion` (it's static anyway). **This is a marketing bookend flourish — never between dashboard / application sections or widgets**, which separate with a plain flat `default` (`#281C40`) hairline (or spacing) per the borders rules above. Do not also draw a section top/bottom border where a divider already sits (see the no-duplicate-borders rule).
- **Input focus = a lighter shade of its own fill.** On focus, an input's border and ring are the **same colour as the input's own background, lightened** (a lighter tint of the field fill) — a soft glow that reads as active without introducing a foreign colour.
- **Chart tooltip items take the series colour.** In a chart tooltip, each listed item — its swatch, label, and value — is rendered in **that series' chart colour**, so the tooltip maps 1:1 to the lines/bars it describes.
- **Button type & icon sizes.** Button label is **max 16px on base and large** buttons and **14px on small** buttons. The **gap between a button's icon and its label is 6px**.
- **Buttons are consistent across sections — same anatomy everywhere.** A given button role looks and behaves identically wherever it appears on a page: a marketing CTA / signup / submit button carries the **same variant, height, radius, label weight, and the bloom-up hover** in the hero, the pricing cards, the CTA band, and the footer signup — do **not** let one section ship a small ghost button while another ships a large bloom primary for the same job. In particular, the **footer newsletter Subscribe button is the same button as the other marketing signup / CTA buttons** (a `brand` bloom primary), not a downsized odd-one-out. **In an input + button pair the two heights must match**: pair a base field shell with a **base** button and a large (`--lg`) field shell with a **large** button — never a `small` button beside a base/large input (it renders visibly shorter than the field and reads as a mistake). Pick the button size to equal the field's control height, and reuse that same button treatment for the equivalent action in every section.
- **Icon sizing.** An **18px icon is reserved for extra-large** contexts only; default UI icons stay smaller (≈14–16px). **Breadcrumb icons are ≤ 14px.** Always the outline style (see the icon-library rule).
- **Table icons are 16px, never larger.** Any icon placed **inside a table** — a data table or a pricing / comparison table — is capped at **16px** (a `check` / `minus` / `x` cell mark, a sort caret, a row-action glyph, an inline status icon, etc.). Never let a table icon grow past 16px; if it sits in a tinted "chip" (e.g. a success circle behind a check), it may go **smaller** (~14px) so the icon reads comfortably inside its container, but 16px is the hard ceiling.
- **Dropdown panel border & shadow.** Every dropdown / menu panel carries a **border in its own background colour, darkened just enough to be visible** — a subtle darker edge of the panel's own fill, never a harsh contrasting line — plus a **medium drop shadow** so the menu lifts cleanly off the page.
- **Dropdown menus never scroll by default.** A dropdown / menu panel shows **all of its content at once** — no internal scrollbar, no capped `max-height`, no `overflow: auto/scroll`. Every item is visible and the panel grows to fit its items. Add a scroll area **only when the prompt explicitly asks for it** (e.g. a long searchable list); absent that instruction, never clip or scroll the menu. The panel always carries the **medium shadow** (see the dropdown panel rule above).
- **One hover background for every link surface.** Wherever a link or menu item shows a **background on hover** — top-nav links, sidebar links, dropdown / menu items, command-palette rows, tab-style links — it uses the **same single hover-background tint** (one subtle neutral fill), so the hover feedback is identical across navbars, sidebars, and dropdowns. Choose one value for this and reuse it everywhere — never give the sidebar one hover colour and the dropdown another. The **active / selected** state is a separate, stronger background (a brand tint), likewise reused consistently across all of these surfaces.
- **Selected table rows use the neutral hover background, not a brand tint.** A selected row takes the **same subtle neutral background a row shows on hover** — never a blue / brand-tinted fill. A row that is both **selected and hovered stays that exact same colour** (no deepening, no shift). Selection is signalled by the row's checkbox / control state, not by recolouring the row.
- **Textarea corners cap at 16px.** A `textarea` (multi-line field) takes a **maximum 16px corner radius** — never the pill / fully-round (999px) rounding that single-line inputs or buttons may use. A 999px radius on a tall multi-line box bows the sides and looks broken; keep textarea corners ≤ 16px so the field reads as a clean rectangle.
- **Application widget grid gap is 16px.** On application / dashboard pages, the gap between widgets in the layout grid — both the row and column gutters between cards/widgets — is **16px**.
- **Hero H1: 72px minimum, 1024px max-width.** The hero's `h1` is the largest type on the page — **at least 72px** font-size, never specced smaller (it may scale down only on narrow mobile viewports for fit). Its text wraps within a **1024px** max-width so a long headline breaks onto a tight, readable column instead of running full-width. The **H1 carries a 44px `margin-bottom`**, which sets the gap down to the supporting paragraph. The supporting paragraph (hero lead) that follows the H1 is **20px** on large screens and scales **smaller on mobile** (≈16–18px), and it **also carries a 44px `margin-bottom`** — separating it from the CTAs / content below. The 44px on the H1 already provides the gap above the paragraph, so the paragraph takes **no separate top margin** (never stack a second gap on top of the H1's 44px).
- **One element owns the vertical padding — never two nested.** When a band, card, or CTA sits inside a section, **only one of them adds vertical padding**. A section and an inner band must not both pad top/bottom, or the block bloats and reads off-center. Decide which container owns the vertical rhythm and zero the padding on the other.
- **Newsletter / signup bands get a dedicated layout — not the button-actions slot.** A CTA that holds an **email field + submit button** is a signup row, not a button group: never drop it into a `cta-card__actions` (or any container built for side-by-side buttons). Build a dedicated band — a **two-column grid on desktop** (copy left, form right) with a **hero-style signup row**: a **full-width field shell + button, inline from ~640px up and stacked below that**. Give it a responsive title, a `font-size-lg` description, and a small helper line (e.g. "No spam. Unsubscribe anytime.") under the form. **Never a fixed narrow field width** (e.g. 18rem) beside a large button — the field flexes to fill the row.
- **Reset native element margins inside cards.** Elements the browser margins by default — `<blockquote>`, `<figure>`, `<p>`, `<ul>` / `<ol>` — are set to **`margin: 0`** whenever they are, or sit inside, a card. Otherwise the user-agent's default margin leaks **outside** the card border and reads as phantom padding around the box (a `<blockquote>` testimonial card is the classic trap). All spacing comes from the card's own padding. Also delete dead modifier classes that style nothing (e.g. unused `--1` / `--2` / `--3` variants).
- **Never delete a CSS rule without proving nothing uses it.** Before removing or "deduplicating" any style, **search the whole codebase for every class / selector it targets** (markup, components, templates, JS) and confirm **zero** references remain. A selector that appears only once in the stylesheet is **not** dead if any element still carries that class — deleting it drops that section to **unstyled HTML**. Deduplicate by **consolidating** repeated declarations into one rule, never by blindly deleting; when in doubt, keep it. After any CSS cleanup, **load the page and confirm every section still renders styled** — then hard-refresh (the dev server may still serve the old CSS bundle).
- **Zero a list's default left padding, not just its margin.** A `<ul>` / `<ol>` used as a layout row, nav, or menu carries the browser's default **~40px left padding** (`padding-inline-start`, reserved for bullets) — `margin: 0` and `list-style: none` do **not** remove it. Explicitly set **`padding: 0`** (or `padding-inline: 0`); if you only set `padding-block`, that left inset stays and the whole row is pushed ~40px inward, misaligning it with the logo / page container. Let the page container own horizontal alignment — the list contributes no indent of its own.
- **Sidebar links: the same lighter background on hover and active.** Every nav link in a sidebar shows a **background fill on both hover and its active / current state, and it is the same fill** — a shade **lighter than the sidebar's own background** so it reads clearly against it. The fill's corners **follow this theme's radius convention** — a pill where the theme is pill-shaped, the theme's standard rounded step otherwise, never a foreign radius. Hover and active look identical in shape and colour; the active item may add a text / icon emphasis (weight or a brand tint) but the background stays that one shared lighter fill.
- **Navbar buttons: one small size, one weight; no underlines on nav / sidebar links.** In a navbar, **every button is the small size** — never mix small with base or large — and **all navbar buttons share the same size and the same text font-weight**, so the bar reads consistent. And **underlined text is never allowed, in any state** (default, hover, focus, active), for **navbar links, navbar buttons, or sidebar links / buttons** — these navigation targets signal interactivity through colour and background, never an underline.
- **Translucent backgrounds must blur what's behind them.** Any element with a **semi-transparent / translucent fill** — a sticky or floating navbar, a frosted card, an overlay, a glass panel — **must** pair that translucency with a **backdrop blur** (`backdrop-filter: blur(...)`, plus the `-webkit-backdrop-filter` prefix for Safari). Without it, page content scrolling **underneath** shows through razor-sharp and reads as a confusing jumble. The blur turns the see-through fill into frosted glass so the element stays legible over anything; keep a tint *with alpha* under the blur so text holds its contrast, and fall back to an opaque fill where `backdrop-filter` is unsupported. (A fully opaque background needs no blur — this applies only when the fill has alpha.)
- **Badges are always width auto — never full-width.** A badge / tag / chip / status pill sizes to **its own content** (`width: auto`, an `inline-flex` / `inline-block` box that hugs its label + optional icon). It **never stretches to fill its container** — no `width: 100%`, no block/flex that spans the row, no `flex: 1`, no `align-items: stretch` pulling it edge-to-edge. Several badges in a row sit side by side (and wrap) at their natural widths, each only as wide as its text.
- **Pricing card: 24px between the price and the CTA button.** In a pricing card, leave **24px** between the **price line** (e.g. `$249/month`) and the **CTA button** tied to it — this is the default gap unless a prompt specifies otherwise. Apply it consistently across every tier so the prices and buttons line up row-to-row.
- **Avatar-only triggers carry no chevron.** In a navbar / top bar, an **avatar shown on its own** (just the photo / initials circle) is itself the trigger — do **not** put a chevron caret beside a bare avatar. A chevron is added **only when the avatar is paired with a visible label** (the person's name / role): `avatar + name → chevron` is fine, `avatar alone → no chevron`. A lone avatar plus a chevron reads as clutter; the avatar is already the affordance.
- **Joined input + button groups square the shared edges.** When an input is **attached to buttons (or addons) on its left and/or right** — a search-with-button, a stepper, a prefix/suffix group, any segmented control where an input touches a button — the **touching edges are squared to `0` radius** so the pieces read as one seamless control. An input with a button on **both sides** has **no border radius at all**; with a button on one side it keeps the theme's radius on the free side and `0` on the joined side. Only the **outer corners of the whole group** carry the theme's normal radius. Critically, the input's **focus border / ring must follow that squared corner too** — never let a rounded corner (or a rounded focus outline) peek out at the seam when the input is focused; the focus state matches the 0-radius joined edge exactly.
- **Card headings are 20px.** A card's heading / title — ecommerce & product cards, feature cards, pricing cards, testimonial and content cards, and cards in general — is **20px**. The **one exception is dashboard / application widgets**: a widget's heading follows the smaller, dense widget-title scale, not this 20px card-title size.
- **Ecommerce navbar collapses to one row on mobile.** On narrow viewports (**< 768px**) the ecommerce header is a **single bar** — logo at the inline start, a **hamburger menu button** at the inline end. The desktop secondary content **collapses off the bar**: the search field, cart / account actions, and the whole category row are **hidden** and move into a **menu panel that opens below the bar** (search + category links + a **"View all categories"** entry). On desktop the full **two-level layout** returns — search + logo + cart / account on the top row, categories on a row beneath. Use the **same hamburger + collapsible-panel pattern as the marketing navbar** so both headers behave consistently.
- **Modals carry a visible border.** On astra's near-black surface a modal **must** have a clear border so the panel edge reads against the dark backdrop — a **1px `default-medium` (`#3A2C57`)** edge (a step stronger than the standard `default` `#281C40`) around the `neutral-primary-soft` panel, on top of the dimming scrim. A borderless modal melts into the black; the border (with the scrim) is what defines the dialog's shape. See `modal.md`.
- **Heading line-height splits at 52px.** A heading's line-height follows its **rendered font size**: only **huge headings — rendered 52px or larger** (chiefly the marketing hero `h1`) use `line-height-display` (**1**); **every heading below 52px** — section `h2` titles, band / sub-section headings, card titles, and any heading whose largest rendered size is under 52px — uses `line-height-heading` (**1.3**). Never put tight 1:1 leading on a sub-52px heading (it crowds multi-line titles); judge a responsive `clamp()` heading by its **maximum** rendered size. See `typography.md`.
- **Card treatments live in `cards.md`.** Astra's card *visual* rules — the dust grain, the top-lit fading border, glued-grid composite panels, the marketing mouse-tracking hover glow, and bento decorative visuals — are specified in full in `cards.md`; read it before building any card.
- **Tables never wear the marketing card hover glow.** The pointer-tracking edge-glow / breathing-border hover treatment from `cards.md` applies to genuine cards and composite card panels only — **never to a table** (data table or pricing / comparison table) or its scroll wrapper, even on a marketing page. A table's only hover feedback is the subtle neutral **row** hover tint from `tables.md`; the table shell itself does not glow, light up, or track the cursor.
- **16px floor for body & reading text.** No **body / paragraph / content text** on a page renders **below 16px** — hero leads, section descriptions, card body copy, list-item prose, and any running text sit at **≥ 16px**. The **only** exceptions are genuine **micro-elements** — badges, chips, tags, table meta / captions, helper & hint microcopy, eyebrows, and similar tiny labels — which may drop below 16px per their component specs. **Never shrink page body copy below 16px to make it fit** — if space is tight, cut words, not the size. This raises the reading-text floor above the 14px control baseline: interactive control labels and the micro-elements above may still use the compact scale, but the text a visitor actually reads does not.
- **Inline input + button pairs are width-bounded.** Wherever an input sits next to a button in one row — a newsletter signup, sign-in, search, or promo field, in **any section, on a landing page, a dashboard, or inside a card** — the **input is never wider than 400px**, and the **whole group (input + button together) is never narrower than 440px nor wider than 600px**. In practice: clamp the group to a **440–600px** band and cap the input at **≤ 400px** inside it (the button takes the remainder). This keeps the field comfortably sized and the pairing balanced — never a stretched full-width input, never a cramped one. Below the group's min width (narrow mobile), stack the button under the input rather than shrinking either past these bounds.
- **Hero & footer backdrop: violet glow + faint grid (astra's signature bookends).** The **hero** and the **footer** are the only two bands that carry a layered atmospheric backdrop over the `#000000` base — the Cobalt-style dark treatment, rendered entirely in astra's palette. Layer it bottom-to-top:
  1. **A radial brand glow.** A large, soft `radial-gradient` of the violet `brand` (`#713DFF`) fading to transparent — a luminous bloom, never a hard-edged shape. Anchor it **top-centre for the hero** (glow spills down from behind the H1) and **bottom-centre for the footer** (glow rises up from the base). Keep it low-intensity: ~18–22% brand at the core → fully transparent by ~60% of the radius. e.g. hero `radial-gradient(120% 80% at 50% 0%, rgba(113,61,255,0.20), transparent 60%)`, footer the same but `at 50% 100%`.
  2. **A barely-visible square grid** overlaid on top: 1px hairlines forming **~64px** squares, drawn in the `default` border colour at low opacity (`rgba(46,33,71,0.5)` — the `#281C40` edge at half strength) or a faint violet (`rgba(113,61,255,0.05)`). Build it from two crossed `linear-gradient`s at `background-size: 64px 64px`. It **must fade out toward the edges** via a radial `mask-image` (visible near the glow / centre, gone by the section boundary) — never a full-bleed, hard-edged grid.
  3. **Content** sits above both layers, fully legible.
  The section **vignettes back to `#000000`** at its edges so neither the grid nor the glow meets the boundary as a hard line. Use only astra's colours (`brand #713DFF`, base `#000000`, raised panel `#0A0118`, border `#281C40`) — never Cobalt's own hues. Apply this to **every** hero and **every** footer; all other sections stay clean on the flat `#000000` surface.
- **Gradient marketing headings — never in app UI.** On **marketing / landing pages**, large display headings (the hero `h1` and section `h2` titles) are filled with a **subtle vertical text gradient** for a premium, luminous look — a `linear-gradient(180deg, …)` clipped to the glyphs (`background-clip: text`, transparent text fill). In astra's palette, run it from **`heading` white (`#FFFFFF`) at the top down to a light lavender — `fg-brand-strong` (`#C4B0FF`)** (a light tint of the `#713DFF` brand) — so the letters catch a faint violet glow at their base. Keep it **shallow**: the top stays near-white so contrast on the `#000000` surface never drops below AA, and always ship a solid `heading` fallback for renderers without text-clip support. **This is forbidden on dashboard / application surfaces** — any in-product / app page, section, widget, table, or component heading stays a **solid `heading`** (flat white) for density and legibility. The gradient is a marketing flourish only; product chrome keeps flat headings.
- **Mockup spacing.** When a mockup or visual (screenshot, app preview, product shot, device frame, illustration) is stacked with text above or below it, leave **~52px** between the mockup and the adjacent content — both above and below — so the visual reads as its own block and never crams against the copy.
- **Prohibited sections are binding.** Each module closes with hard constraints — treat them as such, not as suggestions.

---

## Module index

### Foundation — read first for any UI work

- [colors.md](colors.md) — semantic background, text, border, and status color tokens
- [typography.md](typography.md) — heading scale, body text, labels, links, weights
- [spacing.md](spacing.md) — spacing scale (`spacing-*`) for padding, margin, and gap
- [radius.md](radius.md) — border-radius scale (`radius-xs` … `radius-full`) and the pill-control + 24px-panel convention
- [shadows.md](shadows.md) — elevation tokens (`elevation-none` … `elevation-5`)

### Actions & content

- [buttons.md](buttons.md) — button variants, sizes, states
- [button-group.md](button-group.md) — grouped buttons, toolbars, pagination groups
- [cards.md](cards.md) — card structure, media, actions
- [alerts.md](alerts.md) — inline feedback messages (success, error, warning, info)
- [badges.md](badges.md) — labels, counts, status chips
- [breadcrumb.md](breadcrumb.md) — breadcrumb navigation

### Form controls

Shared shell and validation patterns live in [input-field.md](input-field.md).

- [input-field.md](input-field.md) — single-line text, email, password, URL, groups, search, validation
- [file-input.md](file-input.md) — file upload, multi-file, dropzone
- [number-input.md](number-input.md) — numeric entry, steppers, currency, PIN
- [phone-input.md](phone-input.md) — tel, country code, OTP verification
- [select.md](select.md) — native select and custom dropdown trigger
- [textarea.md](textarea.md) — multi-line text, comment box, chat input, editor chrome
- [timepicker.md](timepicker.md) — time entry, ranges, presets
- [checkbox.md](checkbox.md) — multi-select, list groups, bordered options
- [radio.md](radio.md) — single-select, list groups, advanced card pickers
- [toggle.md](toggle.md) — on/off switch
- [range.md](range.md) — horizontal slider

### Navigation & structure

- [accordion.md](accordion.md) — expandable sections
- [tabs.md](tabs.md) — tab navigation (default, underline, pills, vertical)
- [pagination.md](pagination.md) — page navigation, table pagination
- [dropdowns.md](dropdowns.md) — dropdown menus, items, dividers

### Overlays & feedback

- [modal.md](modal.md) — modal dialogs, form modals, sizes, placement
- [drawer.md](drawer.md) — slide-in panels, navigation drawer
- [tooltips.md](tooltips.md) — tooltips, placement, triggers

### Data display

- [tables.md](tables.md) — table structure, sorting, selection, pagination

---

## Canonical vs. summary files

Some installs ship two layers:

| Layer | Where | Use for |
|---|---|---|
| **Canonical modules** | This directory (`colors.md`, `buttons.md`, …) | Full anatomy, tokens, states, accessibility, and prohibited rules — read before implementing |
| **Summary stubs** | Optional nested skill folder (e.g. `.agents/skills/`, `.cursor/`) | Quick orientation and links into the canonical modules |

Summaries are indexes, not substitutes. If a stub and a module ever disagree — on a color, a size, a variant, anything — **the module in this directory wins.**

## Critical Rules

- **Brand color precedence:** When `brand.md` is available, color tokens from `brand.md` overwrite same-name tokens in `colors.md`.

## Module Index

### Foundation (read first for any UI work)
- [brand.md](brand.md) — Brand
- [colors.md](colors.md) — Color
- [typography.md](typography.md) — Typography
- [radius.md](radius.md) — Radius
- [shadows.md](shadows.md) — Shadow

### Components
- [buttons.md](buttons.md) — Button
- [button-group.md](button-group.md) — Button Group
- [cards.md](cards.md) — Card
- [alerts.md](alerts.md) — Alert
- [badges.md](badges.md) — Badge
- [checkbox.md](checkbox.md) — Checkbox
- [radio.md](radio.md) — Radio
- [toggle.md](toggle.md) — Toggle
- [accordion.md](accordion.md) — Accordion
- [tabs.md](tabs.md) — Tabs
- [pagination.md](pagination.md) — Pagination
- [dropdowns.md](dropdowns.md) — Dropdown
- [modal.md](modal.md) — Modal
- [tooltips.md](tooltips.md) — Tooltip
- [tables.md](tables.md) — Table
- [range.md](range.md) — Range
- [drawer.md](drawer.md) — Drawer
- [select.md](select.md) — Select
- [spacing.md](spacing.md) — Spacing
- [textarea.md](textarea.md) — Textarea
- [breadcrumb.md](breadcrumb.md) — Breadcrumb
- [file-input.md](file-input.md) — File Input
- [timepicker.md](timepicker.md) — Timepicker
- [input-field.md](input-field.md) — Input Field
- [phone-input.md](phone-input.md) — Phone Input
- [number-input.md](number-input.md) — Number Input