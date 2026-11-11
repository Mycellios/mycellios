# Compact velvet Micos

Apply the six approved compact animal/mushroom bodies to web-owned avatars. Keep
the body artwork eyeless and transparent, and draw the neutral eyes from the same
MIT Bloub 0.6.4 artwork/projection used by OpenBot. Do not introduce SolidJS or copy
OpenBot application code. Attribute the original eye files and helpers.

The existing avatar value encodes identity, shape, palette, finish and eyes. Keep
all slots stable and preserve uploaded images and explicit choices. Bare shapes
in the six-body family and their automatic equivalents default to velvet with the
saved palette; other shapes retain existing defaults. Every body must visibly
accept every palette independently of its eye artwork, preserving alpha and
texture. Original artwork colors remain an explicit option.

Avoid per-frame avatar state or idle render loops. The web body remains fixed;
eye hover/working feedback respects reduced motion. Validate the actual component
at 36px in light/dark, color changes for all six bodies, legacy choices, uploads,
working state and mobile viewport. Native Expo keeps its existing vector fallback;
installed native binary qualification is separate. Publish only a traced integrated
web build while retaining current backend services, configuration and rollback.
