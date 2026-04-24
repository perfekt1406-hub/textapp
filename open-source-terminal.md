# Open source terminal — design specification

## Layout architecture

Single preformatted column filling the viewport width—man page layout. A thin nav strip above the main block; everything else is monospace text with fixed-width semantics. No hero, no grids—vertical stack only. Density is uniform—terminal.

## Typography system

Monospace at small comfortable size; line height slightly open for readability. Semantic coloring: dim for section headers, bright for command names, green for links. Title line centered at top of pre block—manual convention.

## Color language

Near-black background, light gray foreground, green links, dim gray for metadata lines. Contrast is moderate—softer than pure white on black. No surfaces—only text and borders.

## Component vocabulary

Horizontal rules as single-line borders between nav and content. No cards, corners, or shadows. Underline on link hover only.

## Motion and interaction cues

Hover shifts link color and underline—terminal feedback. No animation.

## Spatial rhythm

Padding inside pre block scales slightly with viewport; nav line is compact. Alignment left throughout.

## Fidelity & flexibility

**High leverage:** Monospace-only, semantic coloring (dim vs. bright vs. green links), and man-page column layout are non-negotiable—almost no chromatic branding. UX fidelity is documentation: sections, SEE ALSO, no marketing blocks.

**Lower stakes:** Background and dim gray can slide darker/lighter; green link color can shift within terminal convention. The aesthetic is structurally sparse, not palette-precise.

## Design intent

Aesthetic register: Unix manual—credibility through austerity. The aesthetic is refusal of marketing layout in favor of documentation.
