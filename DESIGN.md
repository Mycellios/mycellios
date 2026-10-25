---
name: Mycellios Reference Landing
description: Provisional local public landing with a computing-fabric image and shared Agent controls.
colors:
  ink: "#16221b"
  moss: "#263c2b"
  paper: "#faf9f7"
  stone: "#f0f1ed"
  muted: "#59635d"
  line: "#dadbd3"
  card-white: "#ffffff"
  workspace-canvas: "#181b19"
  workspace-raised: "#232824"
  workspace-text: "#f1f3ee"
  workspace-muted: "#b2b9ae"
  workspace-edge: "#353b35"
typography:
  display:
    fontFamily: '"Geist Variable", sans-serif'
    fontSize: "clamp(40px, 4.5vw, 65px)"
    fontWeight: 500
    lineHeight: 1.04
    letterSpacing: "-0.04em"
  headline:
    fontFamily: '"Geist Variable", sans-serif'
    fontSize: "clamp(34px, 4vw, 54px)"
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  body:
    fontFamily: '"Geist Variable", sans-serif'
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.65
  action:
    fontFamily: '"Geist Variable", sans-serif'
    fontSize: "15px"
    fontWeight: 500
    lineHeight: "20px"
  caption:
    fontFamily: '"Geist Variable", sans-serif'
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  control: "8px"
  inset: "9px"
  group: "10px"
  card: "12px"
  contribution: "14px"
  workspace: "16px"
spacing:
  compact: "8px"
  inline: "12px"
  inset: "16px"
  group: "20px"
  roomy: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "12px 22px"
    height: "52px"
  button-primary-hover:
    backgroundColor: "{colors.moss}"
  button-secondary:
    backgroundColor: "{colors.stone}"
    textColor: "{colors.ink}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "12px 22px"
    height: "52px"
  connection-panel:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.workspace}"
    padding: "10px"
  connection-choice:
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    height: "38px"
  connection-choice-selected:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
  model-select:
    backgroundColor: "{colors.workspace-raised}"
    textColor: "{colors.workspace-text}"
    rounded: "{rounded.control}"
    padding: "4px 10px"
    height: "32px"
  contribution-link:
    backgroundColor: "{colors.card-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.contribution}"
    padding: "22px"
    height: "100px"
---

# Design System: Mycellios Reference Landing

## Overview

**Creative North Star: "The Computing Fabric"**

The public page presents a single computing fabric: dark hardware joined by pale mycelium, surrounded by warm near-white space. Centered type and flat controls keep the opening direct; the large image carries the identity. A contained dark workspace explains Agent through local examples.

This records the current provisional local ReferenceLanding candidate, not user aesthetic approval or a comp-gate pass. Its resolved values apply to this landing in the Agent profile. Existing Agent and classic token scopes retain their ownership; this document does not authorize repainting the panel, studios or Agent application.

**Key Characteristics:**
- Warm near-white space, moss actions and high-contrast conceptual hardware imagery.
- Geist Variable for display, text and controls; native code treatment for literal endpoints.
- Production-kit controls, native disclosures and visible keyboard focus.
- An event-driven print treatment with a plain-image fallback.

Source: `landing/src/rebrand/ReferenceLanding.tsx`, `reference-landing.css`, `NetworkPrint.tsx` and the expanded `AssemblageAgent.tsx`. Shared styles resolve through `assemblage-landing.css`, `landing/src/ui/ui.css`, `agent-style.css` and `agent-components.css`; the historical Assemblage composition is not the visual authority. `landing/src/ui/Landing.stories.tsx` imports the production ReferenceLanding. Product truth remains in `PRODUCT.md` and `docs/STATUS_AND_EVIDENCE.md`; the current direction is the Reference section of `specs/landing-refresh.md`.

Provenance: `/assets/landing/network-fabric.webp` is generated transparent concept artwork, not a photographed installation or a reconstructed 3D model. Its adjacent `.webp.json` preserves the prompt and creation time. Geist's local files retain `/assets/fonts/Geist-LICENSE.txt` (SIL OFL). Sidecar tonal ramps are synthesized preview metadata, not extra production colors. This record supplies no approval receipt, automated-pass claim or quality verdict.

## Colors

Primary ink provides strong text and action fills; moss supplies hover and focus. Paper is the canvas, stone groups connection choices, white marks actionable contribution surfaces, muted supports secondary text, and line separates FAQ/footer content. Frontmatter is the normative list of these resolved local values.

**The Local Paint Rule.** Keep Reference overrides on the public landing container; shared-kit ownership and the separate Agent/classic profiles remain intact.

The Reference container overrides only four inherited color slots: paper, ink, muted and stone. Moss and line are inherited from the common landing stylesheet. The contained Agent example defines its own `--demo-*` dark canvas, raised surface, text, muted and edge slots; its pale action colors remain local to that example. Kit `--ui-*` values map to the nearest surface. Global `--agent-*` and classic tokens are not replaced.

## Typography

Geist Variable serves display, body and controls; headings use medium weight and compact tracking rather than a second display face. The hero description and Agent introduction use `19px` text. Supporting paragraphs use the body role; Agent details are deliberately denser, with `11–14px` content and native code text for attachment previews and the endpoint. Feature titles use `20px`; the FAQ title uses `42px`.

On narrow screens the hero becomes `clamp(29px, 8.5vw, 48px)` with `1.08` line height and an explicit line break. Introductory copy becomes `16px`; the FAQ title becomes `32px`. Agent fields inherit the kit's `16px` text below `767px`.

## Layout

The public shell is capped at `1150px`, with `40px` side gutters on desktop. The centered introduction is followed by a contained image stage, capped at `1600px` with its native `1774 / 877` aspect ratio. The artwork stays centered in normal document flow at every scroll position, without sticky placement, panning or scaling. Below it, the network chapter pairs copy and the API/device connection panel in two columns, stacking them on phones.

The expanded Agent example is a three-column workspace (`230px / flexible / 235px`) with a `510px` minimum height. At `1100px` and below it becomes two columns (`200px / flexible`); the right context column yields to an inline native attachment disclosure. The supporting feature pair uses transparent containers rather than filled cards.

At `760px` and below, side gutters become `20px` and navigation becomes an explicit menu. The artwork retains its native `1774 / 877` aspect ratio without cropping and remains in normal document flow at every size. The network chapter stacks its copy and connection panel underneath the image. The workspace becomes one column, assistant choice becomes a native select, and the model select sits on its own full-width row. Contribution links stack. Keep attachment content available when the right column is absent.

Spacing uses the small steps in frontmatter inside controls and groups. Major separations are intentionally larger: hero top padding `52px`, Agent introduction `105px`, and contribution block padding `140px / 120px`; these reduce on phones.

## Elevation & Depth

Depth is tonal: white actionable surfaces, a pale grouped control and a contained dark workspace. The connection panel has a quiet single edge; ordinary actions have no decorative shadow. The raster retains its physical light and shade, and WebGL adds a print treatment rather than geometric depth.

**The Flat Action Rule.** Actions use flat fills without decorative borders, gradients or shadows. Focus outlines and artwork shading keep their own purposes.

## Shapes

Controls are gently rounded; attached context and code insets use a slightly different small corner, while the connection panel and workspace use the larger radius roles. Contribution links use a single white surface with a leading device icon, text and trailing arrow. Avoid nesting extra frames around the transparent Agent feature pair.

## Components

- **Production kit:** use `Button`, `Link`, `Select`, `Card`, `Disclosure`, `DisclosureSummary`, `Text` and `Heading` from `landing/src/ui/primitives.tsx`. Preserve native elements, refs, disabled states and accessible names.
- **Actions and navigation:** sentence-case actions pair with inline SVG icons. XL marketing controls use the frontmatter dimensions; at narrow widths their height is `48px`, label size `13px`, horizontal padding `13px` and icon gap `8px`. Plain links underline on hover. Common keyboard focus is a `2px` outline with `3px` offset. Escape closes mobile navigation and returns focus to its toggle.
- **Connection panel:** two pressed-state ghost buttons choose API or device content. The API endpoint is a dark inset (`#17291d`, text `#f6faf4`); copy feedback includes a manual fallback. Device actions lead to real downloads and the browser worker. These colors are local component fills, not an additional global theme.
- **Agent example:** five local assistant examples, model selection, attachment switching and permission choices are interactive local state. The narrow attachment disclosure exposes the same bundled example text as the desktop context. Its summary and both native selects retain a light focus outline. The composer opens Agent rather than sending a prompt.
- **Native disclosure:** FAQs and attachment/model/permission groups use real `details`/`summary`. Preserve keyboard behavior and content access; do not infer animated height behavior from the separate panel implementation.
- **Print and motion:** NetworkPrint draws a local raster texture with a bounded WebGL2 print shader; it is not a live 3D network. Rendering is event-driven, pixel ratio is capped at `2`, and hidden documents do not draw. The image stays visible until a GPU frame is ready and returns on context loss. Reduced motion skips WebGL and removes CSS animation, transitions and smooth scrolling. Scrolling never repositions or resizes the artwork; controls use `150ms`, and example messages use `220ms`.
- **Optional artwork comparison:** the usual page retains its original computing fabric. A query-enabled preview adds Actual / Con setas controls using the existing secondary button and pressed-state tokens. The mushroom variant adds restrained ivory fruiting bodies to the same scene. Both retain the native aspect ratio and normal document flow; image selection has no pan, zoom or animated blend. This preview is not approval to replace the default artwork.
- **Evidence boundary:** conceptual hardware does not prove current support or capacity. Agent previews never read user files, run tools or request a model. Real support and observed activity remain in the linked product routes and evidence document.

**The Honest Example Rule.** Keep concept and example labels visible; local choices, attachment text and permission responses are not live telemetry, real file access or model execution.

## Do's and Don'ts

### Do:
- Do reuse production primitives and import the same modules in Storybook.
- Do preserve native select, details/summary, keyboard focus and reduced-motion behavior.
- Do keep the connection panel in the network chapter and the artwork's fallback available.
- Do preserve `?landing=rooted`, `?landing=saved`, `?landing=previous` and the retained `?landing=assemblage` comparison route.

### Don't:
- Don't treat this provisional candidate as an approved global design replacement.
- Don't carry these resolved landing values into the panel, studios, Agent application or classic profile.
- Don't imply supported hardware, physical-network performance, live capacity, completed tasks or payouts from conceptual examples.
- Don't reconstruct a separate Storybook implementation or replace native controls with visual imitations.
