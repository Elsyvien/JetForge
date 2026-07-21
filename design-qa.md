# JetForge Landing Page Design QA

- Design direction: editorial/industrial “generation trace”
- Live hero: native HTML/CSS composition with paper/ink split, typographic headline, generated `J`, and source traces
- Social card: `assets/og-image.png`, retained for Open Graph, Twitter, and structured metadata only
- Product visual: `assets/jetforge-workspace-preview.webp`, shown unframed in the real-workspace section
- Verification date: 2026-07-22
- Runtime: deployment-shaped static artifact served over local HTTP and driven in headless Chromium

## Opening view

The desktop-first hero is a live layout rather than an embedded social card. Its real heading, value statement, install action, demo link, and proof line fit in the opening desktop viewport. The diagonal split and generated `J` carry the same visual idea as the social card without duplicating the raster asset on the page.

At 390 × 844, the content and artwork stack deliberately. The primary action remains in the opening view and the CSS artwork continues below it instead of squeezing the desktop composition into a miniature poster.

The checked 1440 × 900 and 390 × 844 compositions had no horizontal overflow.

## Distilled structure

The page now has four decisions: understand the promise, try the mapping demo, inspect the real workspace, and install. The six-row feature dossier, standalone output-mode chapter, standalone privacy chapter, three-step install route, and two footer links were removed. Essential feature coverage remains in three short proof points, one output-mode line, and the documentation link.

The desktop page is 4,017 CSS pixels tall at 1440 × 900. The demo heading and full interactive workbench fit together in one viewport.

## Visual review

- Desktop: the typographic statement is the focal point; one generated `J`, two traces, and the diagonal seam reinforce source-to-output transformation without competing with the copy.
- Product proof: the genuine VS Code capture sits directly on the paper grid. The former dark wrapper, purple inset outline, and blue offset shadow were removed.
- Social sharing: the existing 1200 × 630 social card remains referenced by Open Graph, Twitter, and schema metadata.
- Full page: duplicate workflow exposition and dedicated secondary chapters were removed. The page now moves directly from proposition to demo, workspace proof, and installation.
- Anti-pattern review: passed. The page avoids generic card grids, glass surfaces, decorative terminal clichés, and a rasterized text hero.

## Interaction and accessibility evidence

- The visual headline is a real `h1`; the hero does not depend on an image to communicate its title.
- Hero elements enter once with staggered opacity/transform motion; two trace lines draw toward the generated mark.
- Workbench mode changes and source-line mappings use brief transform/opacity feedback.
- Button press feedback is immediate and uses a subtle scale change.
- Skip-link, mobile-menu keyboard behavior, workbench tabs, live mapping status, and 44 × 44 CSS-pixel interactive targets remain intact.
- Reduced-motion mode reports zero animations longer than 10 ms.

## Runtime evidence

- Page assets returned successfully over local HTTP and the browser console reported no errors.
- The hero contains no image while `og:image` continues to reference `assets/og-image.png`.
- The workspace screenshot has no outer shadow, border, or generated inset frame.
- Desktop, narrow, normal-motion interaction, and reduced-motion Playwright checks passed.
- `git diff --check` and `npm run verify`: passed.

## Scope not exercised

Physical mobile devices and Safari, Firefox, and Edge were not available. Responsive behavior was driven in Chromium.

## Final result

Final result: passed.
