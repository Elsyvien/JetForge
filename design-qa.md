# JetForge Hero Design QA

- Source visual truth: `assets/og-image.png`
- Genuine extension UI capture: `assets/jetforge-workspace-preview.png`
- Viewport: `1200 × 630`
- State: page loaded at `#top`, entrance reveal complete, navigation closed

## Full-view comparison evidence

The reference and implementation were reviewed together in one side-by-side image. The cream/ink split, diagonal seam, 62px brand lockup, three-line editorial headline, blue italic emphasis, subtitle baseline, textured J artwork, and vertical template-to-output label align closely. The implementation intentionally retains functional navigation, GitHub access, and the Marketplace CTA above the reference composition.

## Focused region comparison evidence

A separate crop was not needed because every fidelity-critical element is legible at the native 1200 × 630 comparison size. Browser geometry additionally confirmed the brand at `x=70, y=62`, the hero height at `630px`, and the subtitle starting at `x=70`.

## Required fidelity surfaces

- Fonts and typography: passed. The existing Iowan/Baskerville editorial stack reproduces the reference hierarchy and line wrapping; the Avenir/Helvetica sans stack matches the brand and subtitle roles.
- Spacing and layout rhythm: passed. Headline, subtitle, brand, seam, and image occupy the same visual bands as the reference.
- Colors and visual tokens: passed. Existing paper, ink, cobalt, violet, and signal tokens match the supplied artwork.
- Image quality and asset fidelity: passed. The actual 1200 × 630 JetForge artwork is used for the right panel with responsive cropping; no placeholder or reconstructed illustration is used.
- Copy and content: passed. The reference headline and subtitle are reproduced verbatim as accessible HTML.

## Findings

- No actionable P0, P1, or P2 findings.
- P3 accepted deviation: functional navigation and installation controls remain visible because they are required product affordances and were absent from the static reference card.

## Patches made during QA

- Replaced the abstract CSS hero mark with the real JetForge artwork.
- Matched the reference split proportions, diagonal seam, brand scale, headline wrapping, and subtitle width.
- Moved the interactive workbench into a dedicated section beneath the hero.
- Added a stacked mobile adaptation with the artwork retained below the copy.
- Tightened the narrow-screen headline scale so all three fixed headline lines remain inside 320 px and 390 px layouts without horizontal clipping.

## Responsive verification

- Desktop (`1440 × 1000`): editorial split, navigation, proof strip, workbench, and install section retain their intended hierarchy.
- Mobile (`390 × 844`): navigation collapses, hero copy/art stack, proof cells become two columns, and interactive controls retain touch-sized targets.
- Narrow mobile (`320 × 720`): no document-level horizontal overflow; the non-wrapping hero headline, command rows, footer links, and code workbench stay within the viewport.
- Reduced motion: reveal content remains visible and transitions collapse to effectively zero duration.

## Final result

final result: passed
