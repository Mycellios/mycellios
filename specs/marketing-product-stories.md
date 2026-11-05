# Marketing product stories and journal

## Scope

Extend the existing Mycellios landing below its approved hero. Explain collaboration,
model continuity, the project browser, routines, contextual permissions and first-use
setup through interactive examples using the current Mico avatars and paper/moss palette.
Keep the background independent of pointer movement. Connections always join visible
nodes; pulses travel over complete paths. Respect reduced motion, user pause and hidden tabs.

The scroll journey alternates light editorial sections with a deep moss project-preview
chapter. Chapters flow directly into one another without a secondary sticky navbar;
section anchors remain available. GSAP sequences build each example as it enters the viewport;
preview surfaces settle with the scroll, without pinning or changing scroll speed.
Only visible examples animate, and user input takes precedence over decorative guidance.
Use existing fungal artwork and Mico avatars. Keep all text readable before scripts run
and while paused. Reduced motion removes travel and decorative cursor/pulse loops.

All illustrative demos start automatically and repeat while visible. The hero rotates
through its Micos and opens the resulting notes; below it the workflow, model, browser,
routine, permission example and setup steps advance without clicks or replay controls.
An explicit pause or reduced-motion preference suspends autoplay. Hidden/off-screen time
does not accumulate. Manual input holds that demo for 12 seconds; focused editable fields
hold it for as long as needed, then the tour resumes. Autoplay never changes real app
permissions, sends requests, edits user input or navigates to another page.

### Motion direction

Creative intent: make collaborative work visible through a precise, organic and
confident network. Keep the approved content, layout, fungal artwork and Mico
identities. The motion language follows the calm/sharp direction reviewed with
the `motion-art-direction` skill; GSAP remains the existing implementation engine.

| Property | Direction |
| --- | --- |
| Timing unit | 200 ms; transitions 400 ms, illustrations 800 ms |
| Easing | `power3.out` for arrivals; `power2.inOut` for visible transfers |
| Transition | Continuous handoff and short crossfade; no spins, bounce or squash |
| Stagger | 60 ms for grouped supporting elements |
| Intensity | UI travel at most 24 px; scale 0.98–1; zero overshoot |
| Hold | At least 400 ms between story beats; final brief rests for 3.2 s |

Hierarchy: the moving document and its illuminated filament lead the collaboration
scene; one active Mico supports it with a small eye movement; the fungal layer is
ambient. The hero's product sequence leads while its heading stays stable.
Text, cards and their ports remain anchored. Growth reveals the mushroom drawing
from its base without stretching it. A completed handoff resolves with a check,
not a group jump. Blink and ambient signal loops are the deliberate time-based
exceptions to the two easing curves. The background never follows the pointer.

The automatic research → planning → review sequence preserves complete connections.
Endpoints are measured from visible ports on resize; packets keep their shape on
narrow screens. Paused/reduced-motion states show the readable finished example;
off-screen and hidden time never advances the tour. All actions remain illustrative.

### Public website motion audit

### Distinct 2D product narratives

The active local direction is strictly 2D: no dioramas, 3D renderer, orbiting camera
or repeated hardware scene. Each feature uses its own composition and artifact:
a document assembling from notes, an editorial collaboration desk, a model patchbay,
a calendar timeline, a permission review and a brief composer. Preserve the paper,
stone and moss branding, the real interface and the readable product claims.
Automatic motion carries a specific action in each scene; typography and detail
provide richness without large cartoon mascots. Reuse the GSAP rhythm, exact
connection endpoints, pause/reduced-motion behavior and original bundle limits.
The existing browser-selection demo remains a separate 2D viewport. The candidate
was checked at desktop, tablet and phone sizes. Both SVG diagrams land exactly on
their DOM ports after resizing, and the routine's runner is bounded to its track.
All seven example sections fit without horizontal overflow. Global pause and live
reduced motion leave a readable finished document. Thirty-six focused tests pass;
the landing keeps its original bundle limits and contains no new 3D scene engine.

Apply the same motion direction across the current public routes: home, Earn,
pricing, comparison index/detail, Desktop downloads, Journal index/article,
Changelog, rewards, staking and public network/Stats views. Documentation remains
a redirect to the canonical repository; the Agent workspace is outside this pass.
Preserve the archived landing variants and existing layouts, content and data flows.

- Shared navigation keeps its hit targets still; underline, ink and child icons
  provide hover/focus feedback. Native menus fade on entry and exit.
- All public FAQs use one animated disclosure pattern and one open answer per group.
  Calculators and installation details use the same real-height transition.
- Hero artwork uses one bounded 800 ms arrival. Financial values and filter results
  update immediately; motion must not imply income, telemetry or completed work.
- Decorative print and mycelium stay independent of pointer movement. The network
  globe retains deliberate drag/select controls, with no inertial motion when paused.
- Background clocks and CSS loops suspend when hidden, off screen or paused.
  Reduced-motion changes take effect without reloading. Static content remains usable.
- Validate desktop and mobile routes, navigation open/close, exclusive accordions,
  calculator fields, paused/reduced states and rendering failures through the real UI.

Implementation: shared 180/240 ms control/menu transitions and 800 ms artwork arrivals;
stationary navigation hit areas; exclusive pricing/rewards FAQs; native-height calculator
and installation disclosures. Disclosure clipping preserves sticky descendants. Public
paper routes no longer flash the dark loader; the dark network/archived themes remain.
The print renderer has no pointer listener. Canvas renderers follow live OS motion
preferences; the network camera retains its pose, accepts deliberate reduced-motion
dragging and stops rendering once its arrival/inertia settles. The closing emblem fades
as one unit so the separate Mico face cannot drift away from its image.

Local verification: 30 current public URLs were opened in the real browser, including all
comparison details, three draft articles and public aliases. Representative desktop
(1440 px), tablet (768 px) and phone (390 px) layouts have no horizontal overflow. Checked
menu keyboard/focus behavior, one-open FAQs, disclosure clipping, sticky pricing summary,
page pause and live reduced-motion changes. Automated checks: 192 affected tests,
TypeScript, repository/UI/architecture gates, landing and standalone downloads builds,
and the shared Storybook build. Home critical JavaScript stays at 349720/350000 bytes.
Source motion lint passed; browser inspection used the supported CUA surface rather
than the skill's separate browser launcher. Changes remain local for review.

## Editorial integration

Reuse Nucleus Content Hub and the existing server-rendered `/blog` routes. Article bodies,
metadata, canonical URLs, structured data, publication state and cache invalidation remain
server-owned. Add a bounded public summary endpoint for homepage discovery, with explicit
empty/unavailable states and no fabricated posts or publication dates. Keep credentials
on the server. Refresh the journal navigation, typography and sitemap to match the landing.
Serve the coordinator-owned dynamic sitemap when publishing, so Nucleus article releases
are not hidden behind an older static marketing sitemap.

The first editorial briefs are: creating a first Mico from useful project notes;
choosing between a provider, a compatible local endpoint and a network model; and
understanding GPU rental estimates versus actual contributor rewards. Use original
Mycellios examples, current implementation evidence and internal links to Agent,
documentation and Stats. Preserve editorial review before these become public articles.

The first three complete English drafts live in `landing/content/journal`, with
Nucleus-compatible localization fields, SEO metadata, existing first-party cover
art and source-review notes. They remain in `human_review`, without publication
dates. The isolated local preview labels them as drafts and disables indexing;
production continues to read published Nucleus content only. Draft files are not
a production fallback or an instruction to publish.

## Acceptance

### Changelog

Add `/changelog` as a lazy public route using the same marketing header and footer.
Use the existing paper/moss palette and original fungal artwork. A release index
groups updates by publication month; product filters have shareable URLs, dated
permalinks and keyboard-accessible controls. Published Desktop previews and Agent
web updates link to their original Mycellios release records. Do not invent
version numbers, publication dates, platform qualification or a mobile release.
Upcoming website/editorial work stays clearly separate from published entries.
Keep the release notes and artwork out of the home critical path. Include the
route in static SEO documents, canonical routing and both sitemap paths. Expose
Changelog through the shared Explore and footer contracts, including Journal.

### Shared navigation and product stories

The public marketing routes and the server-rendered journal share a navigation contract,
official icon paths, a UI-kit stylesheet and a native-disclosure enhancer. The landing
build publishes the exact stylesheet and enhancer for editorial pages, including article,
empty, unavailable and not-found states. Desktop downloads use the same header. Keep the
primary Agent/Earn/Pricing links, Explore destinations, Stats action and all three social
icons identical across public routes and both responsive layouts. Article content remains
server-rendered and menus remain usable when JavaScript is unavailable.

- All six product examples work with keyboard and narrow screens, without real model calls.
- Examples are identified as demonstrations; actions affect only their displayed example.
- A complete readable state is available with reduced motion and when animations pause.
- The hero and legacy landing variants retain their behavior and home bundle budget.
- Published article summaries link to first-party SSR article pages; unpublished content
  never appears as published. Journal errors do not block the landing.
- Blog markup uses current Agent, Earn, Pricing, Stats and journal destinations, retaining
  SEO, sanitization, webhook validation and stale-cache behavior.
- Validate affected tests, typechecks, repository gates, production build and browser
  layouts at desktop, tablet and phone widths. This task prepares a local review.
