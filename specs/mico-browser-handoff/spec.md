# Mico browser handoff

The Open action on a pending Computer card selects the existing Chromium tab of
the requesting conversation when a compatible Docker computer owns that tab.
The API derives the conversation from the waiting run and verifies its account,
Space, Mico, computer binding and execution fence. The helper activates the
saved target under the display lock without navigating it or creating a new tab.
The renderer requests control for the same run. Returning control uses the
current continuation path.

## Tab view

After control is taken, the renderer shows only that tab instead of the noVNC
desktop. `computer.tabViewUrl` requires the waiting run, the user's active
control lease bound to that run and its execution fence. The supervisor starts
the page-browser helper's `tab-stream` on a per-lease Unix socket and publishes it as a
token route on the existing control gateway. `tab.html` is served beside the
noVNC pages and receives the same sealed capability as the embed page.

The stream reads the conversation's own tab mapping and never creates a tab.
It sends bounded JPEG screencast frames, acknowledges each frame only after the
viewer accepted it, follows popups opened by that tab and returns to it when
they close. Viewer input is limited to pointer, wheel, key, pasted text and
history/reload events; everything else is dropped. Releasing control revokes
the route and stops the stream with the terminal. Show desktop returns to noVNC.

An unavailable tab leaves the run waiting and reports the failure. Providers
without scoped Chromium tabs, and computers on older images or supervisors,
keep their existing computer view. This feature requires compatible API,
supervisor and computer image versions.

Verify the scoped helper and tab-stream tests, the supervisor route, runtime
command and capability tests, the API ownership regressions and the needs-you
card browser test. Qualify the complete handoff with a real Docker computer
before claiming that the user's session or screen recovered.
