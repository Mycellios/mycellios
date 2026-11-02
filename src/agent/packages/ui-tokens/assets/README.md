# App icon source

`mycellios-mark.svg` is the editable vector source for Mycellios app icons.
Run `pnpm --filter @rakazo/ui-tokens export:brand` to regenerate the PWA,
desktop and mobile assets using the shared forest/paper palette.

The legacy `Rakazo.icon` source remains upstream material; Mycellios native
configuration uses the generated PNG/ICO assets instead.

The platform exports are:

- `apps/desktop/assets/icon-macos.png`: 1024-pixel desktop export.
- `apps/desktop/assets/icon.ico`: individual 16, 24, 32, 48, 64, 128 and 256 px frames.
- `apps/mobile/assets/icon.png`: opaque 1024-pixel square for the generic/legacy icon,
  with no rounded mask or Dock margins.
- `apps/mobile/assets/adaptive-icon.png`: transparent 1024-pixel Android foreground;
  the mark stays within the central Android safe area.
- `apps/mobile/assets/icon-background.png`: opaque Android background using the
  shared dark background token.
- `apps/mobile/assets/monochrome-icon.png`: matching Android alpha silhouette with
  a transparent hub for themed launchers.

Refresh platform exports after changing the source. Android supplies its own mask;
never bake Mac corners, a rim, or an outer shadow into adaptive layers.

The PWA manifest uses versioned 192/512 px normal icons and a separate opaque
maskable icon. Keep legacy URLs available for installed launchers. Exporting icons
does not publish or rebuild an installed native application; its next package
must include these assets. Marketing/social-card assets are outside this exporter.
