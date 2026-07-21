# JetForge Landing Page Design QA

- Design direction: editorial/industrial “generation trace”
- Product visual: `assets/jetforge-workspace-preview.webp`, derived from the genuine workspace capture
- Social visual: `assets/og-image.png` (metadata only)
- Verification date: 2026-07-18
- Runtime: deployment-shaped static artifact served over local HTTP and driven in headless Chromium

## Opening-view requirement

The hero and first content section were measured at each target viewport. On standard desktop, laptop, tablet, and tall-phone viewports, the hero ends exactly at the viewport boundary and the workbench begins immediately after it. No proof strip or partial next-section bar enters the opening view.

| Viewport | Hero bottom | Workbench top | Horizontal overflow |
| --- | ---: | ---: | ---: |
| 1440 × 900 | 900 px | 900 px | none |
| 1366 × 768 | 768 px | 768 px | none |
| 1280 × 720 | 720 px | 720 px | none |
| 1024 × 768 | 768 px | 768 px | none |
| 820 × 1180 | 1180 px | 1180 px | none |
| 390 × 844 | 844 px | 844 px | none |

Short screens use dedicated compositions rather than squeezing the desktop layout:

- 375 × 667: both actions and a focused source/preview screenshot strip fit in a 667 px hero.
- 320 × 568: primary installation action and a focused screenshot strip fit in a 568 px hero; the redundant jump link is omitted.
- 844 × 390 landscape: compact split layout keeps the complete value statement, both actions, and the full screenshot inside a 390 px hero.
- 640 × 360 (200% zoom proxy): menu remains available, the page has no horizontal overflow, and the next section stays below the opening.

## Visual review

- Desktop and laptop: balanced editorial copy/screenshot split, intact diagonal seam, complete CTA hierarchy, and no clipping.
- Tablet: intentionally stacked copy and product-proof stages; the workspace image remains legible and uncropped.
- Tall mobile: complete headline, explanation, actions, proof line, and product image in one opening view.
- Short mobile: a deliberate center crop emphasizes the source/preview relationship instead of shrinking the full editor to unreadable size.
- Full page: alternating paper, ink, and cobalt chapters preserve a clear long-form rhythm; compact mobile dossier rows reduce the longest cream passage.
- Anti-pattern review: passed. The interface avoids generic card grids, glass surfaces, gradient text, glow effects, and decorative terminal clichés.

## Interaction and accessibility evidence

- Skip link is first in keyboard order and moves focus to `#main`.
- Mobile menu opens from the keyboard, closes with Escape, restores focus, closes after navigation, and is removed from focus order while hidden.
- All six workbench tabs support click, Arrow keys, Home, and End with roving `tabindex`.
- Source-line selection exposes one `aria-pressed="true"` line, one current preview line, and an atomic live status naming the source and preview ranges.
- LaTeX mode reports `report.latexjet` → `report.tex` and updates its mapping status correctly.
- Intended interactive targets measured at least 44 × 44 CSS pixels on mobile.
- Keyboard focus uses a solid 3 px cobalt ring on paper and the context signal color on dark surfaces.
- Forced-colors mode retains a solid 3 px focus indicator and visible content.
- Reduced-motion mode leaves all reveal content visible and manual workbench interaction functional.

## Failure-mode and runtime evidence

- JavaScript disabled, desktop and mobile: navigation remains visible, static Java source/preview content remains present, reveal content stays opaque, and there is no horizontal overflow.
- Runtime requests: no off-origin request, failed request, page error, or console error during the viewport and interaction passes.
- Hero image response: HTTP 200, `image/webp`, 1320 × 768 intrinsic dimensions, 59,672 bytes.
- Local reference audit: 25 unique IDs, seven valid fragment targets, and four existing local assets.
- HTML diagnostics: legacy macOS Tidy reports only its known lack of HTML5-element recognition; with those legacy notices filtered, it reports no additional diagnostics.
- `node --check script.js`, `xmllint --noout sitemap.xml`, and `git diff --check`: passed.
- `npm run verify`: passed, including TypeScript compilation, unit tests, JSON validation, package-hygiene checks, and VSIX packaging.

## Scope not exercised

- Physical iOS/Android devices and Safari, Firefox, and Edge were not available in this environment. Responsive behavior was driven in Chromium with desktop, touch-sized, portrait, landscape, reduced-motion, JavaScript-disabled, forced-colors, and zoom-proxy contexts.

## Final result

Final result: passed.
