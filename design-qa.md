# JetForge Landing Page Design QA

- Design direction: editorial/industrial “generation trace”
- Header visual: `assets/og-image.png`, shared with Open Graph and Twitter cards
- Product visual: `assets/jetforge-workspace-preview.webp`, shown in a dedicated actual-workspace section
- Verification date: 2026-07-22
- Runtime: deployment-shaped static artifact served over local HTTP and driven in headless Chromium

## Opening-view requirement

The shared social poster is now the primary header image. A compact product dock keeps the value statement, install action, workflow link, and proof line in the same opening view without competing with the artwork. The hero ends exactly at the viewport boundary and the workbench starts immediately after it.

| Viewport | Hero bottom | Workbench top | Primary action | Horizontal overflow |
| --- | ---: | ---: | ---: | ---: |
| 1440 × 900 | 900 px | 900 px | 798–850 px | none |
| 1366 × 768 | 768 px | 768 px | 670–722 px | none |
| 1024 × 768 | 768 px | 768 px | 672–724 px | none |
| 820 × 1180 | 1180 px | 1180 px | 1064–1116 px | none |
| 390 × 844 | 844 px | 844 px | 538–590 px | none |
| 320 × 568 | 568 px | 568 px | 403–447 px | none |
| 844 × 390 | 390 px | 390 px | 336–380 px | none |

Short screens use dedicated compositions rather than squeezing the desktop layout:

- 390 × 844 keeps the full poster, value statement, both actions, and proof line in the opening view.
- 320 × 568 keeps the full poster and primary installation action; secondary copy and the redundant jump link are omitted.
- 844 × 390 keeps the complete poster and both actions in a compact landscape composition.

## Visual review

- Desktop and laptop: the 1200 × 630 social artwork is uncropped, centered in an ink field, and paired with a two-column product dock.
- Tablet and phone: the poster preserves its original composition and scales proportionally rather than being cropped into an unreadable fragment.
- Product proof: the genuine VS Code workspace capture now appears after the workflow section in a large editorial frame with source/output registration marks.
- Mobile product proof: the real workspace remains complete and uncropped; its caption simplifies to the two most useful labels.
- Full page: the poster hero, interactive trace, workflow runway, actual-workspace spread, technical dossier, modes, privacy, and install chapters retain the existing paper/ink/cobalt rhythm.
- Anti-pattern review: passed. The interface avoids generic card grids, glass surfaces, gradient text, glow effects, and decorative terminal clichés.

## Interaction and accessibility evidence

- The visual headline is duplicated as a visually hidden `h1`, so the image does not become the only accessible source of the page title.
- Skip link is first in keyboard order and moves focus to `#main`.
- Mobile menu opens from the keyboard, exposes its navigation, closes after navigation, and returns to its compact state.
- All six workbench tabs remain operable; the LaTeX tab reports `report.latexjet` → `report.tex` and updates its live mapping status.
- Intended interactive targets remain at least 44 × 44 CSS pixels on mobile.
- Reduced-motion and forced-colors fallbacks remain intact.

## Failure-mode and runtime evidence

- Runtime requests for the page, versioned CSS/JavaScript, icon, social-card header, and lazily loaded workspace image returned HTTP 200.
- Browser console reported no errors or warnings.
- `assets/og-image.png` retained its 1200 × 630 social-card dimensions.
- `assets/jetforge-workspace-preview.webp` retained its 1320 × 768 intrinsic dimensions and descriptive alternative text.
- Seven checked viewport compositions had no horizontal overflow.
- `node --check script.js`, `git diff --check`, and `npm run verify`: passed.

## Scope not exercised

- Physical iOS/Android devices and Safari, Firefox, and Edge were not available in this environment. Responsive behavior was driven in Chromium with desktop, tablet, portrait-phone, short-phone, and landscape-phone contexts.

## Final result

Final result: passed.
