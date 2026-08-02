# Color Tokens — TypeUI · Astra

> The color system for **TypeUI · Astra**. Astra is **dark-first**: a near-black content surface (`#000000`) with raised panels in deep violet-black (`#0A0118`), carrying a single, vivid **violet** brand (`#713DFF`) that often reads as a gradient glow. Text is light — white headings over muted lavender-gray body — and surfaces separate by a *raised* darker-purple tone plus a subtle border, not a hard line. Status hues (success, danger, warning) appear *only* when something truly is success, danger, or warning; they are never decoration. Every value below is a literal hex and the single source of truth; components reference semantic tokens, never raw hex or palette steps directly.

---

## Token naming

| Pattern | Role |
|---|---|
| `body`, `heading`, `body-subtle` | Default text hierarchy |
| `fg-{intent}` | Foreground / text for brand, status, accent |
| `neutral-{level}-{accent}` | Neutral surfaces (backgrounds) |
| `brand`, `brand-soft`, `brand-strong` | Brand surfaces |
| `success`, `danger`, `warning` (+ `-soft`, `-medium`, `-strong`) | Status surfaces |
| `default`, `light`, `muted`, `buffer` | Border intent |
| `{accent}` | Standalone accent surfaces (purple, cyan, teal, etc.) |

**Level:** `primary` · `secondary` · `tertiary` · `quaternary`  
**Accent (surface):** `soft` · `medium` · `strong` · `strongest`  
**Foreground accent:** `subtle` · `strong`

---

## Semantic tokens — text

| Token | Hex |
|---|---|
| body | `#D2D0DD` |
| body-subtle | `#9B96B0` |
| heading | `#FFFFFF` |
| fg-brand-subtle | `#5B3FB0` |
| fg-brand | `#9B7BFF` |
| fg-brand-strong | `#C4B0FF` |
| fg-success | `#4ADE80` |
| fg-success-strong | `#86EFAC` |
| fg-danger | `#FB7185` |
| fg-danger-strong | `#FDA4AF` |
| fg-warning-subtle | `#FCD34D` |
| fg-warning | `#FBBF24` |
| fg-yellow | `#FBBF24` |
| fg-disabled | `#5A556B` |
| fg-purple | `#A88BFF` |
| fg-cyan | `#22D3EE` |
| fg-indigo | `#9B7BFF` |
| fg-pink | `#F472B6` |
| fg-lime | `#A3E635` |

---

## Semantic tokens — background

### Neutral

| Token | Hex |
|---|---|
| neutral-primary-soft | `#0F0720` |
| neutral-primary | `#0A0118` |
| neutral-primary-medium | `#140A28` |
| neutral-primary-strong | `#1A0F33` |
| neutral-secondary-soft | `#000000` |
| neutral-secondary | `#050010` |
| neutral-secondary-medium | `#0A0118` |
| neutral-secondary-strong | `#0F0720` |
| neutral-secondary-strongest | `#140A28` |
| neutral-tertiary-soft | `#140A28` |
| neutral-tertiary | `#1A0F33` |
| neutral-tertiary-medium | `#241738` |
| neutral-quaternary | `#2E2147` |
| neutral-quaternary-medium | `#3A2C57` |
| gray | `#6B6580` |

### Brand

| Token | Hex |
|---|---|
| brand-softer | `#1A1030` |
| brand-soft | `#2A1B52` |
| brand | `#713DFF` |
| brand-medium | `#8B5CFF` |
| brand-strong | `#5B2BE0` |

### Status

| Token | Hex |
|---|---|
| success-soft | `#0C2818` |
| success | `#22C55E` |
| success-medium | `#14532D` |
| success-strong | `#16A34A` |
| danger-soft | `#2A1015` |
| danger | `#F43F5E` |
| danger-medium | `#4C1D24` |
| danger-strong | `#E11D48` |
| warning-soft | `#2A1E05` |
| warning | `#F59E0B` |
| warning-medium | `#4A3410` |
| warning-strong | `#D97706` |

### Utility & accent

| Token | Hex |
|---|---|
| dark-soft | `#1A0F33` |
| dark | `#0A0118` |
| dark-strong | `#000000` |
| disabled | `#1A0F33` |
| purple | `#A855F7` |
| sky | `#38BDF8` |
| teal | `#2DD4BF` |
| pink | `#F472B6` |
| cyan | `#22D3EE` |
| fuchsia | `#D946EF` |
| indigo | `#713DFF` |
| orange | `#FB923C` |

---

## Semantic tokens — border

| Token | Hex |
|---|---|
| buffer | `#FFFFFF` |
| buffer-medium | `#FFFFFF` |
| buffer-strong | `#FFFFFF` |
| muted | `#140A28` |
| light-subtle | `#1A0F33` |
| light | `#241738` |
| light-medium | `#2E2147` |
| default-subtle | `#241738` |
| default | `#281C40` |
| default-medium | `#3A2C57` |
| default-strong | `#4A3A6B` |
| success-subtle | `#14532D` |
| danger-subtle | `#4C1D24` |
| warning-subtle | `#4A3410` |
| brand-subtle | `#2A1B52` |
| brand-light | `#713DFF` |
| dark-subtle | `#1A0F33` |
| dark-backdrop | `#000000` |

---

## Light theme registry

Flat token map for the default theme. (Astra's canonical surface is **dark**; resolve any lighter theme in your token layer against `#FFFFFF` the same way this resolves against `#000000`.) Implement in your stack’s token layer — theme file, design tokens JSON, variables map, etc.

```
body                          #D2D0DD
body-subtle                   #9B96B0
heading                       #FFFFFF
fg-brand-subtle                 #5B3FB0
fg-brand                        #9B7BFF
fg-brand-strong                 #C4B0FF
fg-success                      #4ADE80
fg-success-strong               #86EFAC
fg-danger                       #FB7185
fg-danger-strong                #FDA4AF
fg-warning-subtle               #FCD34D
fg-warning                      #FBBF24
fg-yellow                       #FBBF24
fg-disabled                     #5A556B
fg-purple                       #A88BFF
fg-cyan                         #22D3EE
fg-indigo                       #9B7BFF
fg-pink                         #F472B6
fg-lime                         #A3E635
neutral-primary-soft            #0F0720
neutral-primary                 #0A0118
neutral-primary-medium          #140A28
neutral-primary-strong          #1A0F33
neutral-secondary-soft          #000000
neutral-secondary               #050010
neutral-secondary-medium        #0A0118
neutral-secondary-strong        #0F0720
neutral-secondary-strongest     #140A28
neutral-tertiary-soft           #140A28
neutral-tertiary                #1A0F33
neutral-tertiary-medium         #241738
neutral-quaternary              #2E2147
neutral-quaternary-medium       #3A2C57
gray                            #6B6580
brand-softer                    #1A1030
brand-soft                      #2A1B52
brand                           #713DFF
brand-medium                    #8B5CFF
brand-strong                    #5B2BE0
success-soft                    #0C2818
success                         #22C55E
success-medium                  #14532D
success-strong                  #16A34A
danger-soft                     #2A1015
danger                          #F43F5E
danger-medium                   #4C1D24
danger-strong                   #E11D48
warning-soft                    #2A1E05
warning                         #F59E0B
warning-medium                  #4A3410
warning-strong                  #D97706
dark-soft                       #1A0F33
dark                            #0A0118
dark-strong                     #000000
disabled                        #1A0F33
purple                          #A855F7
sky                             #38BDF8
teal                            #2DD4BF
pink                            #F472B6
cyan                            #22D3EE
fuchsia                         #D946EF
indigo                          #713DFF
orange                          #FB923C
buffer                          #FFFFFF
buffer-medium                   #FFFFFF
buffer-strong                   #FFFFFF
muted                           #140A28
light-subtle                    #1A0F33
light                           #241738
light-medium                    #2E2147
default-subtle                  #241738
default                         #281C40
default-medium                  #3A2C57
default-strong                  #4A3A6B
success-subtle                  #14532D
danger-subtle                   #4C1D24
warning-subtle                  #4A3410
brand-subtle                    #2A1B52
brand-light                     #713DFF
dark-subtle                     #1A0F33
dark-backdrop                   #000000
```

---

## Usage rules

- **Dark content surface.** The page sits on `neutral-secondary-soft` (`#000000`); content sections share this dark base. Separation comes from *raised* darker-violet panels and subtle borders, plus optional brand gradient glows — never from striping bright colors.
- **Raised panels & cards.** Cards and panels sit on a **raised** surface a step lighter than the page — `neutral-primary` (`#0A0118`) or `neutral-primary-soft` (`#0F0720`) — outlined by a subtle `default` (`#281C40`) border. The lift plus the border is what separates a card from the page.
- **Brand is a violet accent / gradient.** `brand` (`#713DFF`) leads primary actions, links, and highlights; it may render as a gradient (e.g. `brand` → `brand-medium`) for hero CTAs and feature glows. Brand is an accent — not a full-page section fill.
- **Inputs contrast their surface:** controls use a *contrasting* fill (`neutral-tertiary`, `#1A0F33`), a step lighter than the card/section, plus a `default` border, so the field reads on the dark surface. See `input-field.md`.
- **Primary actions:** `brand` background; label uses `white` (the violet brand pairs with a light label).
- **Headings:** `heading` (`#FFFFFF`) · **Body:** `body` (`#D2D0DD`) · **Muted:** `body-subtle` (`#9B96B0`).
- **Links / CTAs:** `fg-brand` (`#9B7BFF`) — a lighter violet that stays legible on the dark surface.
- **Borders:** cards and component shells carry a subtle `default` (`#281C40`) border; `default-strong` is reserved for genuine dividers and the rare functional edge.
- **Disabled states:** `disabled` background + `fg-disabled` text.
- **Never use raw hex in components** — always reference semantic tokens.

## Prohibited

These rules are non-negotiable unless a product brief explicitly documents an exception and a compensating control.

### Token identity — agnostic by design

- **Semantic tokens are this design system’s vocabulary** — named roles (`body`, `brand`, `neutral-secondary-soft`), not imports from any external palette, framework, or vendor scale. Palette tables in this file are derivation reference only; they are **not** token names and **not** licensed aliases for third-party color systems.
- **Do not label or treat tokens as foreign palette steps** — never refer to `brand` as “violet 600”, `body` as “zinc 300”, or `neutral-quaternary` as “gray 800” in specs, code comments, or handoff. If a token exists, use its name.
- **Do not rename tokens to match another stack** — map *into* your implementation layer (theme file, variables map, design tool styles); do not rename tokens to fit a framework’s naming convention and call that “the design system.”
- **Hex values belong to the token registry** — each semantic token owns one resolved hex per theme. Tokens are the contract; hex is the stored value, not something authors pick at build time.

### Implementation boundaries

- **No raw hex in UI surfaces** — components, layouts, illustrations, and marketing assets must reference semantic tokens only. Hex appears in this registry and in the token layer — nowhere else.
- **No palette steps in product UI** — do not apply base-palette rows directly to buttons, text, borders, or backgrounds. Every color choice resolves through a semantic token.
- **No token chaining** — semantic tokens must not point at other tokens or palette variables (`token-a → token-b → #hex`). Each semantic token holds its own hex so the system stays portable and auditable.
- **No one-off colors for “close enough”** — if no token fits, add a token to this file with documented intent; do not hard-code a nearby hex in a single screen or component.
- **No mixing themes on one surface** — dark-registry values and any lighter-registry values must not be blended on the same element because the other theme “looked better.”
- **No bright full-section fills** — page and section backgrounds use the dark neutral surfaces; brand violet is for controls, accents, gradients, and intentional hero/feature glows, not full content-section bands.

### Semantic misuse

- **No brand foreground for long copy** — `fg-brand`, `fg-brand-strong`, and related brand text tokens are for links, labels, badges, and short emphasis — not paragraphs, articles, or legal text. Body copy uses `body` / `body-subtle`.
- **No accent foreground for navigation or body** — `fg-purple`, `fg-cyan`, `fg-pink`, `fg-indigo`, `fg-lime`, and similar accent text tokens are for tags, charts, and inline highlights — not nav items, menu labels, or reading text.
- **No status colors without status meaning** — `success`, `danger`, `warning`, and their `-soft` / `-strong` variants communicate state. Do not use them for decoration, category color-coding unrelated to state, or “making it pop.”
- **No accent backgrounds on full shells** — page backgrounds and section bands use the dark neutral surfaces only. Brand and accent fills are for controls, badges, charts, and intentional hero or campaign glows only.
- **No border tokens as fills or text colors** — `default`, `light`, `brand-subtle`, and other border tokens define edges; do not repurpose them as background or typography colors without adding a proper surface or text token.

### Contrast, accessibility, and states

- **No token pairing that fails readable contrast** — when combining text and surface tokens, verify legibility (WCAG 2.2 AA minimum for text). On the dark surface, body text uses `body` / `body-subtle` and links use the lighter `fg-brand`, never the darker `brand` fill color as text. If a pair fails, change the token assignment or add a dedicated pair to the registry — do not override with raw hex.
- **No disabled styling that looks active** — disabled surfaces use `disabled` + `fg-disabled`; do not reuse `body` or `brand` on disabled controls because they read as clickable.
- **No hover/focus/active colors outside the system** — interaction states must derive from the same semantic set (e.g. a lighter brand step already in the registry), not ad-hoc lightened or darkened hex.

### Governance

- **No silent drift** — changing a token’s hex is a design-system change; update this file, note the reason, and propagate to all platforms. Per-platform hex tweaks break parity.
- **No duplicate tokens for the same job** — if two names resolve to the same role, merge them. Synonym sprawl erodes the agnostic contract.
- **No exceptions without documentation** — breaking any rule above requires naming the exception, the surface it applies to, and why the existing tokens were insufficient.
