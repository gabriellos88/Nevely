# Typography Tokens — TypeUI · Astra

> The type system for **TypeUI · Astra**. Astra speaks in **Inter V** at a compact, businesslike scale — a 14px control/body baseline with a disciplined heading ramp, so interfaces read clean, modern, and competent rather than oversized. Sizes, weights, line heights, letter spacing, and family stacks are literal values and the single source of truth; components reference these tokens (and color tokens from `colors.md`), never ad-hoc type settings.

**Root assumption:** `1rem = 16px` unless the product documents a different root.

**Size scale logic:** Major-second ratio (**×1.125** per step from base), rounded to whole pixels on desktop. Custom text must pick a token from the scale — never invent sizes between steps.

---

## Token naming

| Pattern | Role |
|---|---|
| `font-family` | **Primary UI family** — set once per design system (brand face + fallbacks) |
| `font-family-monospace` | Code and preformatted text only |
| `font-family-serif` | Optional editorial accent — not default UI |
| `font-size-{step}` | T-shirt scale (`xxs` → `10xl`, plus `hero`) |
| `line-height-{role}` | Multipliers for heading, body, component, detail, **display** |
| `font-weight-{step}` | Weight scale (`thin` → `black`) |
| `letter-spacing-{step}` | Tracking scale |

Default body: **`font-size-sm`** + **`line-height-body`** + **`font-weight-normal` (400)** + **`font-family`**.

---

## Primary font family

**`font-family` is the main typography token.** All UI surfaces use `font-family` unless a spec names `font-family-monospace` or `font-family-serif`.

| Token | Value |
|---|---|
| font-family | "Inter V", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif |

**Brand typeface for this design system:** [Inter (Inter V — the variable cut)](https://fonts.google.com/specimen/Inter). Load the face in your product’s font layer; the token above is the stack components reference.

```
font-family   "Inter V", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif
```

### Fallback stack (reference only)

| Token | Stack |
|---|---|
| font-family-fallback | system-ui, -apple-system, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif |

---

## Font size scale — desktop

Base size: **`font-size-sm` = 14px**.

| Token | rem | px |
|---|---|---|
| font-size-xxs | 0.6875rem | 11px |
| font-size-xs | 0.75rem | 12px |
| font-size-sm | 0.875rem | 14px |
| font-size-md | 1rem | 16px |
| font-size-lg | 1.125rem | 18px |
| font-size-xl | 1.25rem | 20px |
| font-size-2xl | 1.375rem | 22px |
| font-size-3xl | 1.5625rem | 25px |
| font-size-4xl | 1.75rem | 28px |
| font-size-5xl | 2rem | 32px |
| font-size-6xl | 2.25rem | 36px |
| font-size-7xl | 2.5rem | 40px |
| font-size-8xl | 2.8125rem | 45px |
| font-size-9xl | 3.125rem | 50px |
| font-size-10xl | 3.75rem | 60px |
| font-size-hero | 4.5rem | 72px |

**`font-size-hero` (72px) is the absolute maximum** for any heading or display text in the system. Nothing may exceed 72px.

---

## Font size scale — mobile

Same token names; values shift up for readability on narrow viewports.

| Token | rem | px |
|---|---|---|
| font-size-xxs | 0.8125rem | 13px |
| font-size-xs | 0.9375rem | 15px |
| font-size-sm | 1.0625rem | 17px |
| font-size-md | 1.1875rem | 19px |
| font-size-lg | 1.375rem | 22px |
| font-size-xl | 1.5rem | 24px |
| font-size-2xl | 1.6875rem | 27px |
| font-size-3xl | 1.9375rem | 31px |
| font-size-4xl | 2.125rem | 34px |
| font-size-5xl | 2.4375rem | 39px |
| font-size-6xl | 2.75rem | 44px |
| font-size-7xl | 3.0625rem | 49px |
| font-size-8xl | 3.4375rem | 55px |
| font-size-9xl | 3.875rem | 62px |
| font-size-10xl | 4.375rem | 70px |

Mobile **`font-size-hero` cap:** 4.5rem (72px) — same ceiling as desktop.

---

## Line height scale

Unitless multipliers applied to the element’s font size.

| Token | Multiplier | Used for | At 14px (`font-size-sm`) |
|---|---|---|---|
| line-height-heading | 1.3 | Headings **rendered below 52px** (section titles, page titles, card titles) | 18.2px |
| line-height-display | 1 | **Huge headings only — rendered 52px and above** (marketing hero h1, display numerals) | Matches font size |
| line-height-detail | 1.3 | Captions, metadata, helper labels | 18.2px |
| line-height-component | 1.3 | Text inside controls (buttons, tabs, chips) | 18.2px |
| line-height-body | 1.5 | Body copy, paragraphs, lists | 21px |
| line-height-code | 1.5 | Monospace blocks and inline code | 21px |

**Default body pairing:** `font-size-sm` + `line-height-body` → 14px / 21px line box.

**Line-height by heading size (mandatory):** The line-height a heading takes is driven by its **rendered font size**, with **52px** as the single cut-off:

- **Huge headings — rendered 52px or larger** (the marketing hero h1, and any display heading that actually reaches ≥ 52px) use **`line-height-display` (1)**; the tight 1:1 leading is part of the Astra marketing look.
- **Everything below 52px** — section titles, sub-section / band headings, card titles, and any heading whose largest rendered size is under 52px (e.g. a `clamp()` that maxes out at 40px) — uses **`line-height-heading` (1.3)**, never `line-height-display`. A `line-height` of 1 on a sub-52px heading crowds multi-line headings; reserve it for the genuinely huge type only.

When a heading uses a responsive `clamp()`, judge by its **maximum** rendered size: if that maximum is below 52px it is a 1.3 heading, even though it shares the display gradient / weight of the larger titles.

---

## Font weight scale

| Token | Value |
|---|---|
| font-weight-thin | 100 |
| font-weight-extra-light | 200 |
| font-weight-light | 300 |
| font-weight-normal | 400 |
| font-weight-medium | 500 |
| font-weight-semibold | 600 |
| font-weight-bold | 700 |
| font-weight-extra-bold | 800 |
| font-weight-black | 900 |

---

## Letter spacing scale

| Token | Value |
|---|---|
| letter-spacing-tightest | -0.15px |
| letter-spacing-tighter | -0.10px |
| letter-spacing-tight | -0.5px |
| letter-spacing-normal | 0px |
| letter-spacing-wide | 0.5px |
| letter-spacing-wider | 0.10px |
| letter-spacing-widest | 0.15px |

Default body tracking: **`letter-spacing-normal`**.

---

## Heading & paragraph gaps (mandatory — fixed 24px)

The vertical gap **below a heading** and **below a paragraph** is **fixed at `spacing-6` (24px)** — never more, never less — so stacked content reads as one consistent beat:

1. **Heading → what follows.** A **heading** (`h1`–`h6`, `.section-heading`, `.card__title`, or equivalent title token) immediately followed by **anything** — a paragraph or lead, a button or button group, a card, a list, an image, or any block — keeps **exactly 24px** below it.
2. **Paragraph → what follows.** A **paragraph** followed by **anything** — another paragraph, a button or button group, a card, a list, an image, or any block — keeps the **same exact 24px** below it.

| Token | Value |
|---|---|
| `spacing-6` | 24px — fixed gap below a heading, and below a paragraph, to whatever follows |

- **24px is a hard, fixed value — not a minimum.** Never exceed 24px and never collapse below it for either gap; both stacking gaps are always exactly 24px.
- Applies anywhere a heading or paragraph stacks above the next block — marketing pages, cards, hero bands, pricing intros, dashboards, and CTAs.
- Eyebrows, badges, or labels *above* a heading may use a smaller gap (`spacing-3` / 12px is typical); the **fixed 24px governs heading → next element and paragraph → next element**.
- Implement with `margin-bottom: spacing-6` on the heading and on the paragraph (or `margin-top: spacing-6` on the following element) — not with a flex `gap` other than 24px between those elements.

---

## Text formatting

| Treatment | Rule |
|---|---|
| **Bold** | Emphasis within a sentence, button labels, toasts — `font-weight-bold` or `font-weight-semibold` |
| **Italic** | Placeholder / ghost text and image captions only — not general UI copy |
| **Underline** | Links only (default or hover per link spec) — never for emphasis |
| **Strong** | Semantic importance — heavier weight |
| **Emphasis** | Semantic stress — italic where appropriate |

Capitalization: **sentence case** for UX strings unless the brief documents an exception (proper nouns, acronyms).

---

## Heading size caps (mandatory)

Semantic HTML level and visual size are independent — but these **maximum visual sizes** apply by surface:

| Surface | h1 max | h2 max | Notes |
|---|---|---|---|
| **Marketing / landing / campaign** | **font-size-hero (72px)** | font-size-9xl (50px) | Display heroes only; never above 72px |
| **Dashboard / application UI** | **font-size-4xl (28px)** | font-size-3xl (25px) | Dense product chrome — one h1 per view |
| **E-commerce (non-hero)** | font-size-4xl (28px) | font-size-3xl (25px) | Storefront hero bands may use marketing caps |
| **Widget / in-card titles** | font-size-2xl (22px) | font-size-xl (20px) | KPI and chart headers stay quiet |

**Rules:**

- **72px is the hard ceiling** for the entire system — use `font-size-hero`; do not add a larger token.
- **28px is the hard ceiling for h1 in dashboard and app UI** — use `font-size-4xl` even if larger display tokens exist.
- **Line-height by size, cut-off at 52px** — only headings **rendered 52px or larger** (e.g. the marketing hero h1) use `line-height-display` (1); **every heading below 52px**, including section titles, uses `line-height-heading` (1.3). Judge a `clamp()` heading by its maximum rendered size.
- Marketing pages must not reuse app-sized h1 tokens on hero bands; app pages must not reuse `font-size-hero` on page titles.

---

## Semantic text roles

Map roles to scale tokens + color tokens from `colors.md`. All roles use **`font-family`** unless noted.

### Application & dashboard

| Role | Family | Size (max) | Weight | Line height | Color token |
|---|---|---|---|---|---|
| app-h1 | font-family | font-size-4xl (28px) | font-weight-bold | line-height-heading | `heading` |
| app-h2 | font-family | font-size-3xl (25px) | font-weight-semibold | line-height-heading | `heading` |
| app-h3 | font-family | font-size-2xl (22px) | font-weight-semibold | line-height-heading | `heading` |
| title | font-family | font-size-xl (20px) | font-weight-medium | line-height-heading | `heading` |
| widget-title | font-family | font-size-xl (20px) | font-weight-medium | line-height-heading | `heading` |
| body | font-family | font-size-sm (14px) | font-weight-normal | line-height-body | `body` |
| body-small | font-family | font-size-xs (12px) | font-weight-normal | line-height-body | `body` |
| label | font-family | font-size-xs (12px) | font-weight-medium | line-height-component | `heading` |
| caption | font-family | font-size-xxs (11px) | font-weight-normal | line-height-detail | `body-subtle` |
| code-inline | font-family-monospace | font-size-xs (12px) | font-weight-normal | line-height-code | `body` |

### Marketing & landing

| Role | Family | Size (max) | Weight | Line height | Color token |
|---|---|---|---|---|---|
| hero-h1 | font-family | font-size-hero (72px) | font-weight-bold | line-height-display | `heading` |
| display | font-family | font-size-10xl (60px) | font-weight-bold | line-height-display | `heading` |
| section-heading | font-family | font-size-7xl (40px) | font-weight-semibold | line-height-heading | `heading` |
| lead | font-family | font-size-lg (18px) | font-weight-normal | line-height-body | `body` |
| body | font-family | font-size-sm (14px) | font-weight-normal | line-height-body | `body` |
| overline | font-family | font-size-xs (12px) | font-weight-medium | line-height-detail | letter-spacing-wider | `body-subtle` |

---

## Specialized font families

| Token | Stack | When |
|---|---|---|
| font-family-monospace | SFMono-Regular, Menlo, Monaco, Consolas, "Roboto Mono", "Ubuntu Mono", "Lucida Console", "Courier New", monospace | Code blocks, inline code |
| font-family-serif | "Times New Roman", Georgia, Garamond, Palatino, Baskerville | Editorial accent (optional) |

---

## Flat registry (desktop)

```
font-family                "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif
font-size-xxs              0.6875rem   (11px)
font-size-xs               0.75rem     (12px)
font-size-sm               0.875rem    (14px)
font-size-md               1rem        (16px)
font-size-lg               1.125rem    (18px)
font-size-xl               1.25rem     (20px)
font-size-2xl              1.375rem    (22px)
font-size-3xl              1.5625rem   (25px)
font-size-4xl              1.75rem     (28px)
font-size-5xl              2rem        (32px)
font-size-6xl              2.25rem     (36px)
font-size-7xl              2.5rem      (40px)
font-size-8xl              2.8125rem   (45px)
font-size-9xl              3.125rem    (50px)
font-size-10xl              3.75rem     (60px)
font-size-hero             4.5rem      (72px)
line-height-heading        1.3
line-height-display        1
line-height-detail         1.3
line-height-component      1.3
line-height-body           1.5
line-height-code           1.5
font-weight-normal         400
font-weight-medium         500
font-weight-semibold       600
font-weight-bold           700
letter-spacing-normal      0px
```

---

## Long-form content (prose)

For article/rich-text bodies (CMS output, docs, help content) map these elements to tokens. All use `font-family` unless noted.

| Element | Size | Weight | Line height | Color | Notes |
|---|---|---|---|---|---|
| Prose paragraph | font-size-md (16px) | font-weight-normal | line-height-body | `body` | `spacing-4` between paragraphs |
| Prose h2 / h3 | font-size-3xl / 2xl | font-weight-semibold | line-height-heading | `heading` | `spacing-6` above, `spacing-3` below |
| Lead paragraph | font-size-lg (18px) | font-weight-normal | line-height-body | `body` | Intro sentence under a heading |
| Unordered / ordered list | font-size-md | font-weight-normal | line-height-body | `body` | `spacing-5` inline-start inset; disc / decimal markers; `spacing-2` between items |
| List with icon markers | font-size-md | font-weight-normal | line-height-body | `body` | 16px leading icon, `spacing-2` gap; no disc marker |
| Description list term | font-size-md | font-weight-semibold | line-height-body | `heading` | Definition below uses `body` |
| Blockquote | font-size-lg (18px) | font-weight-medium | line-height-body | `heading` | 4px (`spacing-1`) inline-start accent border `default-medium`; `spacing-4` inline-start padding; italic optional |
| Inline link in prose | inherit | font-weight-medium | inherit | `fg-brand` | Underline on hover |
| Image caption | font-size-sm (14px) | font-weight-normal | line-height-detail | `body-subtle` | Centered under figure; italic allowed |
| Horizontal rule | — | — | — | `default` | 1px full-width divider; `spacing-8` vertical margin |

Prose blocks may step up one size on large viewports (lead and headings) without exceeding the heading caps above.

---

## Usage by surface type

| Surface | Typical tokens |
|---|---|
| Marketing hero h1 | hero-h1 → font-size-hero (≤72px) + line-height-display |
| Marketing section title | section-heading → font-size-7xl + line-height-heading (below the 52px cut-off) |
| App / dashboard page h1 | app-h1 → font-size-4xl (≤28px) |
| Card / widget title | widget-title → font-size-xl |
| Paragraphs | body → font-size-sm |
| Form labels | label → font-size-xs |
| Buttons (labeled) | font-size-sm + font-weight-medium + line-height-component |
| Badges, chips | font-size-xs or font-size-xxs |
| Code | code-inline |

---

## Prohibited

- **No raw px/rem font sizes in components** — use `font-size-*` tokens from the scale.
- **No numeric size names** (`font-size-100`, `font-size-700`, etc.) — use the t-shirt scale only.
- **No sizes above font-size-hero (72px)** — 72px is the system maximum for any text.
- **No app/dashboard h1 above font-size-4xl (28px)** — even when marketing tokens exist in the scale.
- **No marketing hero sizes on app chrome** — dashboard nav, settings, and data surfaces use app role tokens only.
- **No arbitrary line-height** — use `line-height-heading`, `line-height-display`, `line-height-body`, `line-height-component`, or `line-height-detail`.
- **No `line-height-display` on sub-52px headings** — only headings rendered **52px or larger** use `line-height-display` (1); every heading below 52px (section titles included) uses `line-height-heading` (1.3). Judge `clamp()` headings by their maximum rendered size.
- **No underline for emphasis** — underline is for links only.
- **No italic on general UI copy** — captions and placeholders only.
- **No raw font-family stacks in components** — use `font-family` or `font-family-monospace`.
- **No paragraph width beyond ~50–120 characters** without layout constraint.
- **No fully justified body text** — left-align paragraphs.
- **No negative letter-spacing on body paragraphs** — tight tracking is for headings and overlines only.
