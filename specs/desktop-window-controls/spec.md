# Persistent Desktop window controls

Windows uses native titleBarOverlay controls on a matching host surface. Keep the red/yellow/green visual controls on Linux, including
first-party sign-in and renderer failure. Do not replace them with the OS title
bar or inject privileged controls into hosted login HTML.

On Windows the host keeps native minimize/maximize/close controls via a hidden
caption and titleBarOverlay. A compact transparent drag surface leaves the sidebar color intact. Windows
caption uses a 51px native control area with a transparent background. Reserve
its right-hand area for header actions only. Keep the floating chat header
transparent and borderless so messages scroll behind it. Never pad the whole
root or paint a full-width overlay or an opaque rectangle over message bubbles.
Resolve the main header color through canvas for modern CSS color spaces.
Preserve BrowserWindow.contentView and its geometry on Windows. It may have no
children: never assume children[0], replace it, or inset its parent. A compact
blank drag region is a child of the existing view. Keep controls on login/errors.
Linux retains the trusted compact three-color strip; macOS retains native lights.
No remote page receives new IPC or OS permissions. Preserve profile, runtime and
existing local-renderer repairs when qualifying a local installed-package update.

The local Windows update preserves the installed application and dependencies,
profile and runtime. Focused tests, scoped types, an actual Windows fixture and
installed first-party-login controls passed. The real saved account reopened
without a credential prompt. See canonical STATUS_AND_EVIDENCE.md for current
artifact hashes and verification boundaries. The Windows 0.3.9 caption revision
is now a separate immutable installer (`windows-x64-caption-fix.exe`), published
through the Desktop download catalog. Existing preview installations update by
running that installer manually; unsigned automatic installation remains disabled.
The download publication preserves the current page, Linux/Fedora packages,
headless runtime catalog, account services and prior release URLs.
