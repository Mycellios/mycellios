"""Offline protocol/error regressions for the live browser helper."""
import contextlib
import importlib.machinery
import importlib.util
import io
import json
from pathlib import Path
import socket
import struct
import os
import subprocess
import sys
from tempfile import TemporaryDirectory
import threading
import time
import unittest
from unittest.mock import Mock, patch

loader = importlib.machinery.SourceFileLoader("page_browser", str(Path(__file__).with_name("rakazo-page-browser")))
spec = importlib.util.spec_from_loader(loader.name, loader)
helper = importlib.util.module_from_spec(spec)
loader.exec_module(helper)


class PageBrowserTest(unittest.TestCase):
    def test_conversations_reuse_only_their_own_tabs(self):
        pages = []

        def call(method, _params=None):
            if method == "Target.getTargets":
                return {"targetInfos": pages[:]}
            self.assertEqual(method, "Target.createTarget")
            target = str(len(pages) + 1) * 32
            pages.append({"targetId": target, "type": "page"})
            return {"targetId": target}

        client = Mock()
        client.call.side_effect = call
        with TemporaryDirectory() as directory:
            one = Path(directory) / ("a" * 64)
            two = Path(directory) / ("b" * 64)
            self.assertEqual(helper.scoped_target(client, one, create=True), "1" * 32)
            self.assertIsNone(helper.scoped_target(client, two, create=False))
            self.assertEqual(helper.scoped_target(client, two, create=True), "2" * 32)
            self.assertEqual(helper.scoped_target(client, one, create=False), "1" * 32)
            pages.pop(0)
            self.assertIsNone(helper.scoped_target(client, one, create=False))
            self.assertEqual(helper.scoped_target(client, two, create=False), "2" * 32)

    @unittest.skipUnless(sys.platform.startswith("linux"), "scoped display lock is Linux-only")
    def test_focus_activates_only_the_saved_tab_without_creating_or_navigating(self):
        client = Mock()
        key = "a" * 64
        target = "1" * 32
        other = "2" * 32
        client.call.return_value = {"targetInfos": [
            {"type": "page", "targetId": target}, {"type": "page", "targetId": other},
        ]}
        with TemporaryDirectory() as base:
            directory = Path(base) / "scope"
            directory.mkdir(mode=0o700)
            (directory / key).write_text(target)
            with patch.object(helper, "Path", return_value=directory):
                self.assertEqual(helper.run_scoped(client, 9222, "focus", {"conversationKey": key}), {"ok": True})
                client.call.assert_any_call("Target.activateTarget", {"targetId": target})
                client.call.reset_mock()
                self.assertFalse(helper.run_scoped(client, 9222, "focus", {"conversationKey": "b" * 64})["ok"])
                client.call.assert_not_called()

    def test_closed_stdin_cancels_helper_without_a_browser(self):
        with subprocess.Popen([sys.executable, str(Path(__file__).with_name("rakazo-page-browser")), "snapshot", "{}"],
                              env={**os.environ, "RAKAZO_BROWSER_WATCH_STDIN": "1", "RAKAZO_CDP_PORT": "0"},
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE) as process:
            process.stdin.close()
            self.assertEqual(process.wait(timeout=3), 130)

    def test_closed_extended_frame_does_not_spin(self):
        for partial in (b"\x81\x7e", b"\x81\x7f", b"\x81\x80"):
            with self.subTest(partial=partial):
                client = helper.CdpClient("ws://127.0.0.1:9222/test")
                client._sock = Mock()
                client._sock.recv.return_value = b""
                client._buf.extend(partial)
                with self.assertRaisesRegex(RuntimeError, "closed"):
                    client._read_frame()

    def test_bounds_frame_before_reading_payload(self):
        client = helper.CdpClient("ws://127.0.0.1:9222/test")
        client._sock = Mock()
        client._buf.extend(b"\x81\x7f" + struct.pack("!Q", 10_000_000))
        with self.assertRaisesRegex(RuntimeError, "too large"):
            client._read_frame()
        client._sock.recv.assert_not_called()

    def settling_client(self, idle_after_calls):
        """A client whose page reaches networkIdle on the given getFrameTree call, or never."""
        client = helper.CdpClient("ws://127.0.0.1:9222/test")
        frame_tree_calls = []

        def event(name, loader="L1"):
            client._handle_event({"method": "Page.lifecycleEvent", "sessionId": "session",
                                  "params": {"frameId": "F", "loaderId": loader, "name": name}})

        def call(method, params=None, *, session_id=None, timeout_s=30.0):
            if method == "Page.setLifecycleEventsEnabled":
                # Chromium replays what the current document has reached: loaded, still fetching.
                for name in ("commit", "DOMContentLoaded", "load", "networkAlmostIdle"):
                    event(name)
            if method == "Page.getFrameTree":
                frame_tree_calls.append(method)
                if len(frame_tree_calls) == idle_after_calls:
                    event("networkIdle")
                return {"frameTree": {"frame": {"id": "F"}}}
            return {}

        client.call = call
        return client, frame_tree_calls, event

    def test_snapshot_waits_for_the_page_to_finish_its_requests(self):
        client, calls, _ = self.settling_client(idle_after_calls=3)
        with patch.object(helper, "ensure_helpers"), patch.object(helper, "eval_json") as evaluate, \
                patch.object(helper.time, "sleep"):
            evaluate.return_value = {"title": "Example", "tree": "Signed in as test-user"}
            result = helper.snapshot(client, "session")
        self.assertEqual(len(calls), 3)
        self.assertEqual(result, {"ok": True, "title": "Example", "tree": "Signed in as test-user"})

    def test_snapshot_flags_a_page_that_is_still_loading(self):
        client, calls, _ = self.settling_client(idle_after_calls=0)
        with patch.object(helper, "ensure_helpers"), patch.object(helper, "eval_json") as evaluate, \
                patch.object(helper, "SETTLE_SECONDS", 0.2):
            evaluate.return_value = {"title": "Example", "tree": "Sign in Loading"}
            result = helper.snapshot(client, "session")
        self.assertGreater(len(calls), 1)
        self.assertEqual(result, {"ok": True, "title": "Example", "tree": "Sign in Loading", "loading": True})

    def test_snapshot_reports_loading_when_the_browser_is_too_slow_to_answer(self):
        timeouts = []

        def call(method, params=None, *, session_id=None, timeout_s=30.0):
            # A browser that answers no call before that call's own timeout.
            timeouts.append(timeout_s)
            raise TimeoutError(f"CDP call timed out: {method}")

        client = helper.CdpClient("ws://127.0.0.1:9222/test")
        client.call = call
        with patch.object(helper, "ensure_helpers"), patch.object(helper, "eval_json") as evaluate:
            evaluate.return_value = {"title": "Example", "tree": "Sign in Loading"}
            result = helper.snapshot(client, "session")
        self.assertEqual(result, {"ok": True, "title": "Example", "tree": "Sign in Loading", "loading": True})
        self.assertTrue(timeouts)
        self.assertTrue(all(timeout <= helper.SETTLE_SECONDS for timeout in timeouts), timeouts)

    def test_slow_lifecycle_enable_exhausts_the_settle_budget(self):
        # Advance a fake clock by the timeout an unresponsive CDP call receives.
        now = [0.0]
        calls = []

        def call(method, params=None, *, session_id=None, timeout_s=30.0):
            calls.append((method, timeout_s))
            now[0] += timeout_s
            raise TimeoutError("CDP enable timed out")

        client = helper.CdpClient("ws://127.0.0.1:9222/test")
        client.call = call
        with patch.object(helper.time, "monotonic", side_effect=lambda: now[0]), \
                patch.object(helper, "ensure_helpers"), patch.object(helper, "eval_json") as evaluate:
            evaluate.return_value = {"tree": "Loading"}
            result = helper.snapshot(client, "session")
        self.assertEqual(result, {"ok": True, "tree": "Loading", "loading": True})
        self.assertEqual(calls, [("Page.setLifecycleEventsEnabled", helper.SETTLE_SECONDS)])
        self.assertLessEqual(now[0], helper.SETTLE_SECONDS)

    def test_frame_wait_uses_only_the_budget_left_after_enabling_events(self):
        now = [0.0]
        calls = []

        def call(method, params=None, *, session_id=None, timeout_s=30.0):
            calls.append((method, timeout_s))
            if method == "Page.setLifecycleEventsEnabled":
                now[0] += helper.SETTLE_SECONDS - 0.01
                return {}
            now[0] += timeout_s
            raise TimeoutError("CDP frame timed out")

        client = helper.CdpClient("ws://127.0.0.1:9222/test")
        client.call = call
        with patch.object(helper.time, "monotonic", side_effect=lambda: now[0]):
            self.assertFalse(helper.wait_for_settle(client, "session"))
        self.assertEqual([method for method, _ in calls],
                         ["Page.setLifecycleEventsEnabled", "Page.getFrameTree"])
        self.assertAlmostEqual(calls[1][1], 0.01)
        self.assertLessEqual(now[0], helper.SETTLE_SECONDS)

    def test_a_new_document_does_not_inherit_the_old_one_being_idle(self):
        client, _, event = self.settling_client(idle_after_calls=0)
        event("networkIdle")
        event("init", loader="L2")
        event("load", loader="L2")
        self.assertEqual(client.lifecycle("session", "F"), {"init", "load"})

    def test_snapshot_waits_while_the_page_shows_loading_placeholders(self):
        client, calls, _ = self.settling_client(idle_after_calls=1)
        busy = iter([True, True, False])

        def evaluate(_client, _session, expression, *_args):
            return next(busy) if expression == helper.page_call("busy") else {"tree": "Loaded"}

        with patch.object(helper, "ensure_helpers"), patch.object(helper, "eval_json", side_effect=evaluate), \
                patch.object(helper.time, "sleep"):
            self.assertEqual(helper.snapshot(client, "session"), {"ok": True, "tree": "Loaded"})
        self.assertEqual(len(calls), 3)

    def test_placeholders_still_shown_at_the_deadline_mean_loading(self):
        client, _, _ = self.settling_client(idle_after_calls=1)

        def evaluate(_client, _session, expression, *_args):
            return True if expression == helper.page_call("busy") else {"tree": "Partial list"}

        with patch.object(helper, "ensure_helpers"), patch.object(helper, "eval_json", side_effect=evaluate), \
                patch.object(helper, "SETTLE_SECONDS", 0.2):
            self.assertEqual(helper.snapshot(client, "session"), {"ok": True, "tree": "Partial list", "loading": True})

    def test_later_parts_of_a_long_page_skip_the_wait_and_read_what_the_first_captured(self):
        client = helper.CdpClient("ws://127.0.0.1:9222/test")
        part = {"tree": "Part two", "elements": [], "next": 3}
        with patch.object(helper, "wait_for_settle") as settle, patch.object(helper, "ensure_helpers"), \
                patch.object(helper, "eval_json", return_value=part) as evaluate:
            self.assertEqual(helper.snapshot(client, "session", 2), {"ok": True, **part})
        settle.assert_not_called()
        self.assertEqual(evaluate.call_args.args[2], helper.page_call("snapshot", 2))

    def test_a_part_that_is_gone_is_settled_and_a_bad_part_number_never_reads(self):
        gone = "This page has 2 part(s), numbered from 0, so there is no part 5."
        with patch.object(helper, "snapshot", side_effect=helper.Refused(gone)):
            self.assertEqual(helper.run_page_command(Mock(), "session", "snapshot", {"from": 5}),
                             {"ok": False, "uncertain": False, "error": gone})
        with patch.object(helper, "snapshot") as snapshot:
            for bad in (-1, helper.SNAPSHOT_PARTS, "1", True, 1.5):
                with self.subTest(bad=bad), self.assertRaisesRegex(RuntimeError, "from must be"):
                    helper.run_page_command(Mock(), "session", "snapshot", {"from": bad})
        snapshot.assert_not_called()

    def test_calls_reach_the_object_the_isolated_world_installs(self):
        self.assertIn(f"window.{helper.PAGE_HELPER} = {{", helper.EVAL_HELPERS)
        self.assertEqual(helper.page_call("typed", "e1", 'a"b'), f'window.{helper.PAGE_HELPER}.typed("e1", "a\\"b")')
        self.assertIn(f"const PARTS = {helper.SNAPSHOT_PARTS};", helper.EVAL_HELPERS)

    def test_capabilities_are_answered_without_the_browser(self):
        for command in ("capabilities", "scoped-capabilities"):
            out = io.StringIO()
            with self.subTest(command=command), contextlib.redirect_stdout(out), \
                    patch.object(helper, "wait_for_cdp", side_effect=AssertionError("no browser")):
                self.assertEqual(helper.run(["helper", command, "{}"]), 0)
            self.assertEqual(json.loads(out.getvalue()), {"ok": True, "features": list(helper.FEATURES)})

    def test_navigate_returns_the_first_snapshot_or_stands_without_it(self):
        client = Mock()
        client.call.side_effect = lambda method, params=None, **_: (
            {"loaderId": "L1"} if method == "Page.navigate" else {"frameTree": {"frame": {"id": "main", "loaderId": "L1"}}})
        answers = {"document.readyState": "complete", "location.href": "https://example.test/",
                   "(document.title || '').slice(0, 200)": "Example"}
        first = {"ok": True, "url": "https://example.test/", "title": "Example", "tree": "Welcome", "elements": []}
        for snapshot, expected in (({"return_value": first}, first),
                                   ({"side_effect": RuntimeError("busy")},
                                    {"ok": True, "url": "https://example.test/", "title": "Example"})):
            with self.subTest(expected=expected), patch.object(helper, "ensure_world"), \
                    patch.object(helper, "eval_json", side_effect=lambda _c, _s, expression, *_: answers[expression]), \
                    patch.object(helper, "snapshot", **snapshot):
                self.assertEqual(helper.navigate(client, "session", "https://example.test/"), expected)

    def test_a_page_that_does_not_answer_is_settled_instead_of_timing_out(self):
        client = Mock()

        def call(method, params=None, **_):
            if method == "Target.getTargets":
                return {"targetInfos": [{"type": "page", "targetId": "1" * 32}]}
            if method == "Target.attachToTarget":
                return {"sessionId": "s"}
            raise TimeoutError(f"CDP call timed out: {method}")

        client.call.side_effect = call
        out = io.StringIO()
        with contextlib.redirect_stdout(out), patch.object(helper, "wait_for_cdp"), \
                patch.object(helper, "discover_ws_url", return_value="ws://127.0.0.1:9222/browser"), \
                patch.object(helper, "CdpClient", return_value=client):
            self.assertEqual(helper.run(["helper", "act", json.dumps({"actions": [{"kind": "click", "ref": "e1"}]})]), 0)
        result = json.loads(out.getvalue())
        self.assertEqual({key: result[key] for key in ("ok", "uncertain", "completed")},
                         {"ok": False, "uncertain": False, "completed": 0})
        self.assertIn("not responding", result["error"])
        self.assertNotIn("fallback", result)

    def test_rejects_url_credentials_before_navigation(self):
        client = Mock()
        for url in ("http://example:fake-password@example.test", "https://example:fake-password@example.test"):
            with self.assertRaisesRegex(RuntimeError, "credentials"):
                helper.navigate(client, "session", url)
        client.call.assert_not_called()

    def test_rejects_navigation_error(self):
        client = Mock()
        client.call.return_value = {"errorText": "net::ERR_NAME_NOT_RESOLVED"}
        with self.assertRaisesRegex(RuntimeError, "ERR_NAME_NOT_RESOLVED"):
            helper.navigate(client, "session", "https://example.test")

    def test_preserves_completed_actions_when_next_response_is_lost(self):
        with patch.object(helper, "ensure_helpers"), patch.object(helper, "eval_json") as evaluate:
            evaluate.side_effect = [True, {}, True, TimeoutError("lost response")]
            result = helper.act(Mock(), "session", [
                {"kind": "click", "ref": "first"}, {"kind": "click", "ref": "second"},
            ])
        self.assertEqual(result["completed"], 1)
        self.assertTrue(result["uncertain"])
        self.assertFalse(result["ok"])

    def test_rejects_missing_text_before_any_action(self):
        with patch.object(helper, "ensure_helpers") as ensure:
            with self.assertRaisesRegex(RuntimeError, "Text"):
                helper.act(Mock(), "session", [{"kind": "fill", "ref": "first"}])
            ensure.assert_not_called()

    def test_binds_saved_login_fill_to_its_origin_in_the_same_evaluation(self):
        with patch.object(helper, "ensure_helpers"), patch.object(helper, "snapshot", return_value={"ok": True}), \
                patch.object(helper, "eval_json") as evaluate:
            evaluate.side_effect = [True, {}]
            helper.act(Mock(), "session", [
                {"kind": "fill", "ref": "e1", "text": "fake-password", "origin": "https://login.example.test",
                 "field": "password"},
            ])
        self.assertEqual(
            evaluate.call_args_list[1].args[2],
            'window.__rakazoPageBrowser.fill("e1", "fake-password", "https://login.example.test", "password")',
        )

    def test_reports_a_refused_fill_as_settled_with_its_reason(self):
        client = Mock()
        client.call.side_effect = [
            {"result": {"value": True}},
            {"exceptionDetails": {"text": "Uncaught", "exception": {
                "description": "Error: Refused: The page is not on the site this login was saved for."
                               "\n    at Object.fill (<anonymous>:1:1)",
            }}},
        ]
        with patch.object(helper, "ensure_helpers"):
            result = helper.act(client, "session", [
                {"kind": "fill", "ref": "e1", "text": "fake-password", "origin": "https://login.example.test",
                 "field": "password"},
            ])
        self.assertEqual(result, {"ok": False, "completed": 0, "uncertain": False,
                                  "error": "The page is not on the site this login was saved for."})

    def test_rejects_origin_outside_fill_before_any_action(self):
        with patch.object(helper, "ensure_helpers") as ensure:
            with self.assertRaisesRegex(RuntimeError, "origin"):
                helper.act(Mock(), "session", [
                    {"kind": "type", "ref": "e1", "text": "x", "origin": "https://login.example.test"},
                ])
            ensure.assert_not_called()

    def test_key_events_press_printable_characters_and_insert_the_rest(self):
        self.assertEqual(helper.key_event("6"),
                         {"key": "6", "code": "Digit6", "text": "6", "windowsVirtualKeyCode": 54})
        self.assertEqual(helper.key_event("q")["code"], "KeyQ")
        self.assertEqual(helper.key_event("Q")["windowsVirtualKeyCode"], 81)
        self.assertEqual(helper.key_event(" ")["code"], "Space")
        self.assertEqual(helper.key_event("\n"), {"key": "Enter", "code": "Enter", "text": "\r",
                                                  "windowsVirtualKeyCode": 13, "modifiers": 8})
        self.assertEqual(helper.key_event("@"), {"key": "@", "text": "@"})
        self.assertIsNone(helper.key_event("é"))

    def type_once(self, focus, text, typed=True, after_key=None, more=(), on_clear=None, page=None):
        """Runs one type step against a stand-in browser.

        after_key(n, client, state) runs once key n has landed; on_clear(client, state) while the field is emptied.
        """
        client = helper.CdpClient("ws://browser.example.test:9222/test")
        sent = []
        state = {"focused": True, "gone": False}

        def call(method, params=None, **_):
            if method == "Page.getFrameTree":
                document = (client.navigations("session", "main"), state["gone"])
                return {"frameTree": {"frame": {"id": "main", "loaderId": str(document)}}}
            sent.append((method, params))
            if after_key and (method == "Input.insertText" or params.get("type") == "keyUp"):
                after_key(sum(m == "Input.insertText" or p.get("type") == "keyUp" for m, p in sent), client, state)
            return {}

        def evaluate(_, __, expression):
            if state["gone"]:
                raise RuntimeError("Runtime.evaluate failed: Cannot find context with specified id")
            if "resolve(" in expression:
                return True
            if "focusForKeys(" in expression:
                if on_clear:
                    on_clear(client, state)
                return focus
            if "focusHolds()" in expression:
                return state["focused"]
            if "typed(" in expression:
                return typed
            return {}

        client.call = call
        with patch.object(helper, "ensure_helpers"), \
                patch.object(helper, "snapshot", return_value=page or {"ok": True}), \
                patch.object(helper, "eval_json", side_effect=evaluate) as evaluated:
            result = helper.act(client, "session", [{"kind": "type", "ref": "e1", "text": text}, *more])
        return result, sent, [call.args[2] for call in evaluated.call_args_list]

    @staticmethod
    def navigate_on(key, event="Page.frameRequestedNavigation", **params):
        def after_key(n, client, state):
            if n == key:
                client._handle_event({"method": event, "sessionId": "session",
                                      "params": {"frameId": "main", **params}})
        return after_key

    def test_type_presses_each_key_into_the_focused_field(self):
        result, sent, evaluated = self.type_once({"focused": True, "multiline": False}, "6é")
        self.assertEqual(result, {"ok": True, "completed": 1})
        self.assertEqual(evaluated[1], 'window.__rakazoPageBrowser.focusForKeys("e1", true)')
        self.assertEqual(evaluated[-1], 'window.__rakazoPageBrowser.typed("e1", "6\\u00e9")')
        self.assertEqual(sent, [
            ("Input.dispatchKeyEvent", {"type": "keyDown", "key": "6", "code": "Digit6", "text": "6",
                                        "windowsVirtualKeyCode": 54, "unmodifiedText": "6"}),
            ("Input.dispatchKeyEvent", {"type": "keyUp", "key": "6", "code": "Digit6", "windowsVirtualKeyCode": 54}),
            ("Input.insertText", {"text": "é"}),
        ])

    def test_type_of_one_character_replaces_only_the_box_it_is_typed_into(self):
        result, sent, evaluated = self.type_once({"focused": True, "multiline": False}, "8")
        self.assertEqual(result, {"ok": True, "completed": 1})
        self.assertEqual(evaluated[1], 'window.__rakazoPageBrowser.focusForKeys("e1", false)')
        self.assertEqual([params["key"] for _, params in sent if params.get("type") == "keyDown"], ["8"])

    def test_type_checks_the_page_before_every_key_and_after_the_last(self):
        _, sent, evaluated = self.type_once({"focused": True, "multiline": False}, "482913")
        self.assertEqual(len([params for _, params in sent if params.get("type") == "keyDown"]), 6)
        self.assertEqual(evaluated.count("window.__rakazoPageBrowser.focusHolds()"), 7)

    def test_type_presses_no_key_when_emptying_the_field_made_the_page_navigate(self):
        def on_clear(client, _):
            client._handle_event({"method": "Page.frameRequestedNavigation", "sessionId": "session",
                                  "params": {"frameId": "main", "disposition": "currentTab"}})
        result, sent, _ = self.type_once({"focused": True, "multiline": False}, "482913", on_clear=on_clear)
        self.assertEqual(sent, [])
        self.assertEqual({key: result[key] for key in ("ok", "completed")}, {"ok": False, "completed": 0})
        self.assertIn("page changed while typing, after 0 of 6 characters", result["error"])

    def test_type_breaks_lines_with_shift_enter_only_where_a_line_break_belongs(self):
        _, one_line, _ = self.type_once({"focused": True, "multiline": False}, "a\r\nb\n")
        self.assertNotIn("Enter", [params.get("key") for _, params in one_line])
        _, text_area, _ = self.type_once({"focused": True, "multiline": True}, "a\r\nb\rc")
        enters = [params for _, params in text_area if params.get("key") == "Enter"]
        # One line break per newline, each a Shift+Enter in both the key press and its release.
        self.assertEqual([(params["type"], params["modifiers"]) for params in enters],
                         [("keyDown", 8), ("keyUp", 8)] * 2)
        self.assertNotIn("Input.insertText", [method for method, _ in text_area])

    def test_type_reports_characters_the_page_did_not_keep(self):
        result, _, _ = self.type_once({"focused": True, "multiline": False}, "A7K29Q", typed=False)
        self.assertEqual({key: result[key] for key in ("ok", "completed")}, {"ok": False, "completed": 1})
        self.assertIn("did not keep every character", result["error"])
        self.assertNotIn("A7K29Q", result["error"])

    def test_type_stops_at_once_when_the_page_navigates_mid_code(self):
        events = [
            ("Page.frameRequestedNavigation", {"disposition": "currentTab"}),
            ("Page.frameStartedNavigating", {"navigationType": "differentDocument"}),
            ("Page.frameNavigated", {}),
        ]
        for event, params in events:
            with self.subTest(event=event):
                if event == "Page.frameNavigated":
                    def after_key(n, client, _):
                        if n == 2:
                            client._handle_event({"method": event, "sessionId": "session",
                                                  "params": {"frame": {"id": "main"}}})
                else:
                    after_key = self.navigate_on(2, event, **params)
                result, sent, _ = self.type_once({"focused": True, "multiline": False}, "482913",
                                                 after_key=after_key)
                self.assertEqual([p["key"] for _, p in sent if p.get("type") == "keyDown"], ["4", "8"])
                self.assertEqual({key: result[key] for key in ("ok", "completed")}, {"ok": False, "completed": 0})
                self.assertIn("page changed while typing, after 2 of 6 characters", result["error"])
                self.assertNotIn("482913", result["error"])

    def test_type_stops_when_the_document_is_gone_before_any_event_arrives(self):
        def after_key(n, _, state):
            state["gone"] = n == 3
        result, sent, _ = self.type_once({"focused": True, "multiline": False}, "482913", after_key=after_key)
        self.assertEqual(len([p for _, p in sent if p.get("type") == "keyDown"]), 3)
        self.assertIn("page changed while typing", result["error"])

    def test_type_keeps_going_through_same_document_and_other_tab_navigations(self):
        elsewhere = [
            ("Page.frameStartedNavigating", {"frameId": "main", "navigationType": "sameDocument"}),
            ("Page.frameRequestedNavigation", {"frameId": "main", "disposition": "newTab"}),
            ("Page.frameRequestedNavigation", {"frameId": "ad", "disposition": "currentTab"}),
        ]

        def after_key(n, client, _):
            if n == 1:
                for event, params in elsewhere:
                    client._handle_event({"method": event, "sessionId": "session", "params": params})
        result, sent, _ = self.type_once({"focused": True, "multiline": False}, "482913", after_key=after_key)
        self.assertEqual(result, {"ok": True, "completed": 1})
        self.assertEqual(len([p for _, p in sent if p.get("type") == "keyDown"]), 6)

    def test_type_that_submits_on_the_last_key_is_done_and_later_steps_are_stale(self):
        signed_in = {"ok": True, "url": "https://code.example.test/done", "title": "Signed in", "elements": []}
        result, sent, evaluated = self.type_once(
            {"focused": True, "multiline": False}, "482913", after_key=self.navigate_on(6),
            more=[{"kind": "click", "ref": "e2"}], page=signed_in)
        self.assertEqual(len([p for _, p in sent if p.get("type") == "keyDown"]), 6)
        # The result is the page the code led to.
        self.assertEqual({key: result.get(key) for key in ("ok", "completed", "url", "title")},
                         {"ok": False, "completed": 1, "url": signed_in["url"], "title": "Signed in"})
        self.assertIn("Stale element ref", result["error"])
        self.assertFalse(any("typed(" in expression or "click(" in expression for expression in evaluated))
        alone, _, _ = self.type_once({"focused": True, "multiline": False}, "482913", after_key=self.navigate_on(6))
        self.assertEqual(alone, {"ok": True, "completed": 1})

    def test_type_stops_when_focus_leaves_the_field_or_its_code(self):
        def after_key(n, _, state):
            state["focused"] = n < 3
        result, sent, _ = self.type_once({"focused": True, "multiline": False}, "482913", after_key=after_key)
        self.assertEqual([p["key"] for _, p in sent if p.get("type") == "keyDown"], ["4", "8", "2"])
        self.assertEqual({key: result[key] for key in ("ok", "completed")}, {"ok": False, "completed": 0})
        self.assertIn("Focus left the field while typing, after 3 of 6 characters", result["error"])
        self.assertNotIn("482913", result["error"])

    def test_type_into_a_select_chooses_the_option_as_fill_does(self):
        result, sent, evaluated = self.type_once({"select": True}, "Blue")
        self.assertEqual(result, {"ok": True, "completed": 1})
        self.assertEqual(evaluated[2], 'window.__rakazoPageBrowser.fill("e1", "Blue")')
        self.assertEqual(sent, [])

    def test_type_presses_nothing_when_the_field_does_not_take_focus(self):
        result, sent, _ = self.type_once({"focused": False, "multiline": False}, "x")
        self.assertFalse(result["ok"])
        self.assertIn("keyboard focus", result["error"])
        self.assertEqual(sent, [])

    def test_reads_arguments_from_one_stdin_line_only(self):
        payload = b'{"actions": []}\nrest'
        with patch.object(helper.os, "read", side_effect=[payload[i:i + 1] for i in range(len(payload))]) as read:
            self.assertEqual(helper.read_stdin_line(), '{"actions": []}')
        self.assertEqual(read.call_count, len(b'{"actions": []}\n'))

    def test_discovery_cannot_leave_loopback_endpoint(self):
        with patch.object(helper, "http_get_json", return_value={"webSocketDebuggerUrl": "ws://example.test:9222/session"}):
            with self.assertRaisesRegex(RuntimeError, "Unexpected CDP"):
                helper.discover_ws_url(9222)

    def test_ensure_world_reuses_named_isolated_context(self):
        client = helper.CdpClient("ws://127.0.0.1:9222/test")
        calls = []

        def fake_call(method, params=None, *, session_id=None, timeout_s=30.0):
            calls.append(method)
            if method == "Page.getFrameTree":
                return {"frameTree": {"frame": {"id": "frame-1"}}}
            if method == "Runtime.enable":
                client._handle_event({
                    "method": "Runtime.executionContextCreated",
                    "sessionId": session_id,
                    "params": {
                        "context": {
                            "id": 42,
                            "name": helper.WORLD_NAME,
                            "auxData": {"frameId": "frame-1", "isDefault": False},
                        }
                    },
                })
                return {}
            raise AssertionError(f"unexpected CDP call: {method}")

        client.call = fake_call  # type: ignore[method-assign]
        helper.ensure_world(client, "session-a")
        self.assertEqual(client.context_id, 42)
        self.assertNotIn("Page.createIsolatedWorld", calls)

    def test_context_lookup_rejects_default_foreign_and_unbound_contexts(self):
        client = helper.CdpClient("ws://127.0.0.1:9222/test")
        for aux, session in (({"frameId": "frame-1", "isDefault": True}, "session-a"),
                             ({"frameId": "other-frame", "isDefault": False}, "session-a"),
                             ({"frameId": "frame-1", "isDefault": False}, "session-b"),
                             ({}, "session-a")):
            client._handle_event({"method": "Runtime.executionContextCreated", "sessionId": session,
                                  "params": {"context": {"id": 42, "name": helper.WORLD_NAME, "auxData": aux}}})
            self.assertIsNone(client.find_world_context(helper.WORLD_NAME, "frame-1", "session-a"))

    def test_ensure_world_creates_when_missing(self):
        client = helper.CdpClient("ws://127.0.0.1:9222/test")

        def fake_call(method, params=None, *, session_id=None, timeout_s=30.0):
            if method == "Page.getFrameTree":
                return {"frameTree": {"frame": {"id": "frame-1"}}}
            if method == "Runtime.enable":
                return {}
            if method == "Page.createIsolatedWorld":
                self.assertEqual(params["worldName"], helper.WORLD_NAME)
                return {"executionContextId": 7}
            raise AssertionError(f"unexpected CDP call: {method}")

        client.call = fake_call  # type: ignore[method-assign]
        helper.ensure_world(client, "session-a")
        self.assertEqual(client.context_id, 7)

    def test_upload_paths_must_be_existing_files_inside_home(self):
        import tempfile
        with tempfile.TemporaryDirectory() as home, tempfile.TemporaryDirectory() as outside:
            receipt = Path(home, "receipts", "march.pdf")
            receipt.parent.mkdir()
            receipt.write_bytes(b"%PDF-1.4")
            secret = Path(outside, "secret.txt")
            secret.write_text("nope")
            Path(home, "escape.txt").symlink_to(secret)

            self.assertEqual(
                helper.resolve_upload_paths(["receipts/march.pdf"], home),
                [os.path.realpath(receipt)],
            )
            for paths, message in (
                (["../" + Path(outside).name + "/secret.txt"], "inside this computer's home"),
                ([str(secret)], "inside this computer's home"),
                (["escape.txt"], "inside this computer's home"),
                (["receipts/missing.pdf"], "File not found"),
                (["receipts"], "Not a regular file"),
                ([], "1 to 10"),
                (["a"] * 11, "1 to 10"),
                ([""], "non-empty"),
            ):
                with self.subTest(paths=paths), self.assertRaisesRegex(RuntimeError, message):
                    helper.resolve_upload_paths(paths, home)

    def test_upload_confinement_checks_symlinked_parents_without_leaking_targets(self):
        import tempfile
        with tempfile.TemporaryDirectory() as home, tempfile.TemporaryDirectory() as outside:
            Path(home, "parent").symlink_to(outside, target_is_directory=True)
            for exists in (False, True):
                if exists:
                    Path(outside, "secret.txt").write_text("secret")
                with self.subTest(exists=exists), self.assertRaises(RuntimeError) as error:
                    helper.resolve_upload_paths(["parent/secret.txt"], home)
                self.assertEqual(str(error.exception),
                                 "Upload files must be inside this computer's home folder: parent/secret.txt")
                self.assertNotIn(outside, str(error.exception))

    def test_team_upload_roots_confine_files_and_roots_after_symlinks(self):
        import tempfile
        with tempfile.TemporaryDirectory() as home, tempfile.TemporaryDirectory() as outside:
            for folder in ("bots/b1", "bots/b2", "shared"):
                Path(home, folder).mkdir(parents=True)
            for file in ("bots/b1/own.txt", "bots/b2/secret.txt", "shared/brief.txt", "root.txt"):
                Path(home, file).write_text("fixture")
            Path(home, "bots/b1/link").symlink_to(Path(home, "bots/b2/secret.txt"))
            Path(home, "bots/b1/parent").symlink_to(Path(home, "bots/b2"), target_is_directory=True)
            roots = ["bots/b1", "shared"]
            self.assertEqual(helper.resolve_upload_paths(
                ["bots/b1/own.txt", "shared/brief.txt"], home, roots),
                [str(Path(home, "bots/b1/own.txt").resolve()), str(Path(home, "shared/brief.txt").resolve())])
            for path in ("bots/b1/link", "bots/b1/parent/secret.txt", "root.txt"):
                with self.subTest(path=path), self.assertRaises(RuntimeError) as error:
                    helper.resolve_upload_paths([path], home, roots)
                self.assertEqual(str(error.exception),
                                 f"Upload files must be inside your folder or shared/: {path}")
                self.assertNotIn(home, str(error.exception))
            for root in ("missing", "escaped"):
                if root == "escaped":
                    Path(home, root).symlink_to(outside, target_is_directory=True)
                with self.subTest(root=root), self.assertRaisesRegex(RuntimeError, "your folder or shared/"):
                    helper.resolve_upload_paths(["root.txt"], home, [root])

    def test_team_upload_missing_root_does_not_block_the_other(self):
        import tempfile
        with tempfile.TemporaryDirectory() as home:
            Path(home, "bots/b1").mkdir(parents=True)
            Path(home, "bots/b1/own.txt").write_text("fixture")
            self.assertEqual(
                helper.resolve_upload_paths(["bots/b1/own.txt"], home, ["bots/b1", "shared"]),
                [str(Path(home, "bots/b1/own.txt").resolve())],
            )

    def test_team_upload_rejects_roots_redirected_to_another_bot(self):
        import tempfile
        with tempfile.TemporaryDirectory() as home:
            Path(home, "bots/b2").mkdir(parents=True)
            Path(home, "bots/b2/secret.txt").write_text("fixture")
            Path(home, "bots/b1").symlink_to(Path(home, "bots/b2"), target_is_directory=True)
            Path(home, "shared").symlink_to(Path(home, "bots/b2"), target_is_directory=True)
            for path in ("bots/b1/secret.txt", "shared/secret.txt"):
                with self.subTest(path=path), self.assertRaisesRegex(RuntimeError, "your folder or shared/"):
                    helper.resolve_upload_paths([path], home, ["bots/b1", "shared"])

    def test_upload_rejects_fifo_without_opening_it(self):
        import tempfile
        with tempfile.TemporaryDirectory() as home:
            os.mkfifo(Path(home, "pipe"))
            with patch("builtins.open", side_effect=AssertionError("must not open FIFO")):
                with self.assertRaisesRegex(RuntimeError, "Not a regular file: pipe"):
                    helper.resolve_upload_paths(["pipe"], home)

    def test_upload_absolute_paths_and_literal_tilde(self):
        import tempfile
        with tempfile.TemporaryDirectory() as home, tempfile.TemporaryDirectory() as outside:
            file = Path(home, "x")
            file.write_text("fixture")
            self.assertEqual(helper.resolve_upload_paths([str(file)], home), [str(file.resolve())])
            with self.assertRaisesRegex(RuntimeError, "File not found: ~/x"):
                helper.resolve_upload_paths(["~/x"], home)
            for exists in (False, True):
                target = Path(outside, "x")
                if exists:
                    target.write_text("fixture")
                with self.assertRaisesRegex(RuntimeError, "must be inside"):
                    helper.resolve_upload_paths([str(target)], home)

    def test_upload_total_size_limit(self):
        import tempfile
        with tempfile.TemporaryDirectory() as home:
            for name in ("a", "b"):
                Path(home, name).write_bytes(b"123")
            with patch.dict(os.environ, {"RAKAZO_BROWSER_UPLOAD_MAX_BYTES": "5"}):
                self.assertEqual(helper.resolve_upload_paths(["a"], home), [str(Path(home, "a").resolve())])
                with self.assertRaisesRegex(RuntimeError, "upload files are larger than .* MB in total"):
                    helper.resolve_upload_paths(["a", "b"], home)
            for override in ("invalid", "0", "-1"):
                with patch.dict(os.environ, {"RAKAZO_BROWSER_UPLOAD_MAX_BYTES": override}):
                    self.assertEqual(len(helper.resolve_upload_paths(["a", "b"], home)), 2)
            with patch.dict(os.environ, {}, clear=True):
                with patch.object(helper.os, "stat", return_value=Mock(
                        st_mode=0o100644, st_size=helper.MAX_UPLOAD_BYTES + 1)):
                    with self.assertRaisesRegex(RuntimeError, "larger than 100 MB in total"):
                        helper.resolve_upload_paths(["a"], home)

    def test_upload_act_passes_trusted_roots_before_touching_the_page(self):
        with patch.object(helper, "resolve_upload_paths", side_effect=RuntimeError("confined")) as resolve:
            with patch.object(helper, "ensure_helpers") as ensure:
                with self.assertRaisesRegex(RuntimeError, "confined"):
                    helper.act(Mock(), "session", [{"kind": "upload", "ref": "e1",
                               "paths": ["bots/b1/file"], "roots": ["bots/b1", "shared"]}])
            resolve.assert_called_once_with(["bots/b1/file"], roots=["bots/b1", "shared"])
            ensure.assert_not_called()

    def test_upload_sets_files_on_the_input_without_a_file_chooser(self):
        client = Mock()
        client.context_id = 7
        client.call.side_effect = [{"result": {"objectId": "node-1"}}, {}, {}]
        helper.upload(client, "session", "e1", ["/home/rakazo/receipt.pdf"])
        methods = [call.args[0] for call in client.call.call_args_list]
        self.assertEqual(methods, ["Runtime.evaluate", "DOM.setFileInputFiles", "Runtime.releaseObject"])
        self.assertEqual(
            client.call.call_args_list[1].args[1],
            {"files": ["/home/rakazo/receipt.pdf"], "objectId": "node-1"},
        )

    def test_upload_rejects_a_bad_path_before_touching_the_page(self):
        with patch.object(helper, "ensure_helpers") as ensure:
            with self.assertRaisesRegex(RuntimeError, "File not found"):
                helper.act(Mock(), "session", [{"kind": "upload", "ref": "e1", "paths": ["nope.pdf"]}])
        ensure.assert_not_called()


CONFIRM = {"type": "confirm", "message": "Delete this file?"}


def run_page_steps(steps, evaluate=None, frame_url=None, page=None, clock=None, after_key=None):
    """Runs act() against a stand-in page.

    evaluate(expression) answers the page helper's calls, or returns None for the usual answer: refs
    resolve and take focus, anything else is an empty object. page is the final snapshot, or an
    exception that reading it raises. clock is a one-item list of fake seconds that sleeps advance.
    after_key(client) runs once each key is released.
    """
    client = helper.CdpClient("ws://browser.example.test:9222/test")
    sent, evaluated = [], []

    def call(method, params=None, **_):
        sent.append((method, params))
        if method == "Page.getFrameTree":
            url = frame_url() if frame_url else "https://example.test/start"
            return {"frameTree": {"frame": {"id": "main", "url": url,
                                            "loaderId": str(client.navigations("session", "main"))}}}
        if method == "Target.getTargetInfo":
            return {"targetInfo": {"url": "https://example.test/start", "title": "Start"}}
        if method == "Input.dispatchKeyEvent" and params.get("type") == "keyUp" and after_key:
            after_key(client)
        return {}

    def evaluate_json(_client, _session, expression, *_args):
        evaluated.append(expression)
        answer = evaluate(expression) if evaluate else None
        if answer is not None:
            return answer
        return True if ".resolve(" in expression or ".focusRef(" in expression else {}

    client.call = call
    reading = {"side_effect": page} if isinstance(page, BaseException) else {"return_value": page or {"ok": True, "tree": "After"}}
    with contextlib.ExitStack() as stack:
        stack.enter_context(patch.object(helper, "ensure_helpers"))
        stack.enter_context(patch.object(helper, "snapshot", **reading))
        stack.enter_context(patch.object(helper, "eval_json", side_effect=evaluate_json))
        if clock is not None:
            stack.enter_context(patch.object(helper.time, "monotonic", side_effect=lambda: clock[0]))
            stack.enter_context(patch.object(helper.time, "sleep",
                                             side_effect=lambda seconds: clock.__setitem__(0, clock[0] + seconds)))
        result = helper.act(client, "session", steps)
    return result, sent, evaluated


def dialog_on(fragment):
    """An evaluate() for run_page_steps whose call containing fragment opens a dialog."""
    def evaluate(expression):
        if fragment in expression:
            raise helper.DialogOpened(dict(CONFIRM))
        return None
    return evaluate


class PageStepsTest(unittest.TestCase):
    """press, scroll, hover and wait."""

    def test_key_names_shortcuts_and_the_text_they_type(self):
        self.assertEqual(helper.key_combo("Enter"),
                         {"key": "Enter", "code": "Enter", "windowsVirtualKeyCode": 13, "text": "\r"})
        self.assertEqual(helper.key_combo("control+a"),
                         {"key": "a", "code": "KeyA", "windowsVirtualKeyCode": 65, "modifiers": 2})
        self.assertEqual(helper.key_combo("Shift+a")["text"], "A")
        self.assertEqual(helper.key_combo("Esc")["key"], "Escape")
        self.assertEqual(helper.key_combo("ArrowDown")["windowsVirtualKeyCode"], 40)
        for key in ("", "Hyper+Q", "Control+Control+A", "F13", "é", "Control+", None, "x" * 41):
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, "press needs a key"):
                helper.key_combo(key)

    def test_press_sends_one_key_with_its_modifiers_to_the_focused_element(self):
        result, sent, evaluated = run_page_steps([{"kind": "press", "key": "Shift+Tab"}])
        self.assertEqual(result, {"ok": True, "tree": "After", "completed": 1})
        self.assertEqual([params for method, params in sent if method == "Input.dispatchKeyEvent"], [
            {"type": "rawKeyDown", "key": "Tab", "code": "Tab", "windowsVirtualKeyCode": 9, "modifiers": 8},
            {"type": "keyUp", "key": "Tab", "code": "Tab", "windowsVirtualKeyCode": 9, "modifiers": 8},
        ])
        self.assertEqual(evaluated, [])

    def test_press_on_a_ref_focuses_it_first_and_presses_nothing_when_it_cannot(self):
        result, _, evaluated = run_page_steps([{"kind": "press", "key": "Backspace", "ref": "e2"}])
        self.assertEqual(result["completed"], 1)
        self.assertEqual(evaluated, [f"Boolean({helper.page_call('resolve', 'e2')})", helper.page_call("focusRef", "e2")])
        refused, sent, _ = run_page_steps([{"kind": "press", "key": "Enter", "ref": "e2"}],
                                          evaluate=lambda expression: False if ".focusRef(" in expression else None)
        self.assertEqual({key: refused[key] for key in ("ok", "completed", "uncertain")},
                         {"ok": False, "completed": 0, "uncertain": False})
        self.assertIn("did not take keyboard focus", refused["error"])
        self.assertNotIn("Input.dispatchKeyEvent", [method for method, _ in sent])

    def test_a_key_that_loads_another_page_leaves_its_refs_behind(self):
        def submit(client):
            client._handle_event({"method": "Page.frameRequestedNavigation", "sessionId": "session",
                                  "params": {"frameId": "main", "disposition": "currentTab"}})
        results = {"ok": True, "url": "https://example.test/results", "tree": "Results"}
        result, _, evaluated = run_page_steps(
            [{"kind": "press", "key": "Enter"}, {"kind": "wait", "until": "text", "text": "Results"},
             {"kind": "click", "ref": "e3"}],
            evaluate=lambda expression: True if ".waitState(" in expression else None, after_key=submit, page=results)
        # The wait ran in the new document; the click's ref belongs to the old one.
        self.assertEqual({key: result.get(key) for key in ("ok", "completed", "url", "uncertain")},
                         {"ok": False, "completed": 2, "url": "https://example.test/results", "uncertain": False})
        self.assertIn("Stale element ref", result["error"])
        self.assertFalse(any(".click(" in expression for expression in evaluated))

    def test_scroll_moves_the_page_or_brings_a_ref_into_view(self):
        result, _, evaluated = run_page_steps([{"kind": "scroll", "direction": "down"}, {"kind": "scroll", "ref": "e4"}])
        self.assertEqual(result["completed"], 2)
        self.assertEqual(evaluated, [helper.page_call("scroll", None, "down"),
                                     f"Boolean({helper.page_call('resolve', 'e4')})", helper.page_call("scroll", "e4", None)])

    def test_hover_moves_the_real_pointer_to_the_middle_of_the_element(self):
        result, sent, _ = run_page_steps([{"kind": "hover", "ref": "e5"}],
                                         evaluate=lambda e: {"x": 40.5, "y": 12} if ".hoverPoint(" in e else None)
        self.assertEqual(result["completed"], 1)
        self.assertIn(("Input.dispatchMouseEvent",
                       {"type": "mouseMoved", "x": 40.5, "y": 12, "button": "none", "buttons": 0}), sent)

    def test_hover_refuses_an_element_that_something_else_covers(self):
        def covered(expression):
            if ".hoverPoint(" in expression:
                raise helper.Refused("Another element covers this one, so it was not hovered.")
            return None
        result, sent, _ = run_page_steps([{"kind": "hover", "ref": "e5"}, {"kind": "click", "ref": "e6"}],
                                         evaluate=covered)
        self.assertEqual(result, {"ok": False, "completed": 0, "uncertain": False,
                                  "error": "Another element covers this one, so it was not hovered."})
        self.assertNotIn("Input.dispatchMouseEvent", [method for method, _ in sent])

    def test_wait_polls_until_the_text_appears(self):
        answers = iter([False, False, True])
        clock = [0.0]
        result, _, evaluated = run_page_steps([{"kind": "wait", "until": "text", "text": "Saved"}],
                                              evaluate=lambda e: next(answers) if ".waitState(" in e else None,
                                              clock=clock)
        self.assertEqual(result, {"ok": True, "tree": "After", "completed": 1})
        self.assertEqual(evaluated.count(helper.page_call("waitState", "text", "Saved")), 3)
        self.assertAlmostEqual(clock[0], 2 * helper.WAIT_POLL_SECONDS)

    def test_a_wait_that_runs_out_is_settled_and_shows_the_page(self):
        clock = [0.0]
        result, _, evaluated = run_page_steps(
            [{"kind": "wait", "until": "gone", "text": "Loading", "timeout": 2}, {"kind": "click", "ref": "e1"}],
            evaluate=lambda e: False if ".waitState(" in e else None, clock=clock, page={"ok": True, "tree": "Loading"})
        self.assertEqual({key: result[key] for key in ("ok", "completed", "uncertain", "tree")},
                         {"ok": False, "completed": 0, "uncertain": False, "tree": "Loading"})
        self.assertEqual(result["error"], '"Loading" was still on the page after 2 seconds. '
                                          "Check the page in this snapshot before trying again.")
        self.assertLessEqual(clock[0], 2 + helper.WAIT_POLL_SECONDS)
        self.assertFalse(any(".click(" in expression for expression in evaluated))

    def test_waits_in_one_call_share_their_time(self):
        clock = [0.0]

        def state(expression):
            if ".waitState(" not in expression:
                return None
            # The first text appears after about 12 of its 15 seconds, leaving 3 for the second wait.
            return '"first"' in expression and clock[0] >= 11.9

        result, _, _ = run_page_steps([{"kind": "wait", "until": "text", "text": "first", "timeout": 15},
                                       {"kind": "wait", "until": "text", "text": "second", "timeout": 10}],
                                      evaluate=state, clock=clock)
        self.assertEqual(result["completed"], 1)
        self.assertIn('"second" did not appear after 3 seconds.', result["error"])
        self.assertIn(f"Waits in one browser_act share {helper.WAIT_BATCH_SECONDS:g} seconds.", result["error"])

    def test_wait_for_the_address_to_change_or_to_contain_text(self):
        urls = iter(["https://example.test/start"] * 3 + ["https://example.test/next#done"] * 9)
        result, _, _ = run_page_steps([{"kind": "wait", "until": "url"}, {"kind": "wait", "until": "url", "text": "#DONE"}],
                                      frame_url=lambda: next(urls), clock=[0.0])
        self.assertEqual(result["completed"], 2)

    def test_a_wait_reads_a_new_document_once_its_helper_is_back(self):
        answers = iter([RuntimeError("Cannot find context with specified id"), True])

        def state(expression):
            if ".waitState(" not in expression:
                return None
            answer = next(answers)
            if isinstance(answer, Exception):
                raise answer
            return answer

        result, _, _ = run_page_steps([{"kind": "wait", "until": "quiet"}], evaluate=state, clock=[0.0])
        self.assertEqual(result["completed"], 1)

    def test_new_steps_are_checked_before_anything_runs(self):
        for steps, message in (
            ([{"kind": "hover"}], "ref is required"),
            ([{"kind": "press", "key": "Enter", "ref": ""}], "ref is required"),
            ([{"kind": "press"}], "press needs a key"),
            ([{"kind": "scroll"}], "scroll needs"),
            ([{"kind": "scroll", "direction": "sideways"}], "scroll needs"),
            ([{"kind": "wait", "until": "soon"}], "wait needs until"),
            ([{"kind": "wait", "until": "text"}], "needs text"),
            ([{"kind": "wait", "until": "quiet", "timeout": 16}], "at most 15"),
            ([{"kind": "wait", "until": "url", "text": "x" * 501}], "1 to 500"),
            ([{"kind": "dialog"}], "accept"),
            ([{"kind": "click", "ref": "e1"}] * 25, "1 to 24"),
        ):
            with self.subTest(message=message), patch.object(helper, "ensure_helpers") as ensure:
                with self.assertRaisesRegex(RuntimeError, message):
                    helper.act(Mock(), "session", steps)
                ensure.assert_not_called()


class PageDialogTest(unittest.TestCase):
    def test_a_dialog_ends_the_wait_on_its_page_and_holds_back_its_calls(self):
        client = helper.CdpClient("ws://127.0.0.1:9222/test")
        client._sock = Mock()
        frames = []
        client._read_frame = lambda: frames.pop(0)
        client._send_frame = Mock()
        frames.append(json.dumps({"method": "Page.javascriptDialogOpening", "sessionId": "s",
                                  "params": {"type": "confirm", "message": "Delete this file?",
                                             "url": "https://example.test/", "hasBrowserHandler": True}}).encode())
        with self.assertRaises(helper.DialogOpened) as opened:
            client.call("Runtime.evaluate", {"expression": "1"}, session_id="s")
        self.assertEqual(opened.exception.dialog, CONFIRM)
        self.assertEqual(client._pending, {})
        client._send_frame.reset_mock()
        with self.assertRaises(helper.DialogOpened):
            client.call("Input.dispatchKeyEvent", {"type": "keyUp"}, session_id="s")
        client._send_frame.assert_not_called()
        # The browser itself still answers for the tab, and other tabs are not held back.
        for method, session in (("Page.handleJavaScriptDialog", "s"), ("Target.getTargetInfo", "s"),
                                ("Runtime.evaluate", "other"), ("Target.getTargets", None)):
            frames.append(json.dumps({"id": client._next_id, "result": {"method": method}}).encode())
            self.assertEqual(client.call(method, session_id=session), {"method": method})
        frames.append(json.dumps({"method": "Page.javascriptDialogClosed", "sessionId": "s",
                                  "params": {"result": True}}).encode())
        frames.append(json.dumps({"id": client._next_id, "result": {}}).encode())
        client.call("Target.getTargets")
        self.assertEqual(client.dialogs, {})

    def test_dialog_details_are_bounded_untrusted_text(self):
        self.assertEqual(helper.dialog_info({"type": "prompt", "message": "x" * 5000, "defaultPrompt": "Ada"}),
                         {"type": "prompt", "message": "x" * helper.DIALOG_TEXT_LIMIT, "defaultPrompt": "Ada"})
        self.assertEqual(helper.dialog_info({"type": "script", "message": None}), {"type": "alert", "message": ""})

    def test_a_step_that_opens_a_dialog_ends_the_call_with_its_message(self):
        result, _, evaluated = run_page_steps([{"kind": "click", "ref": "e1"}, {"kind": "click", "ref": "e2"}],
                                              evaluate=dialog_on('.click("e1")'))
        self.assertEqual(result, {"ok": False, "uncertain": False, "url": "https://example.test/start", "title": "Start",
                                  "dialog": CONFIRM, "completed": 1,
                                  "error": "Step 1 (click) opened a confirm dialog. The remaining 1 step(s) did not run."})
        self.assertFalse(any('.click("e2")' in expression for expression in evaluated))

    def test_a_dialog_before_a_step_reached_the_page_does_not_count_it(self):
        result, _, _ = run_page_steps([{"kind": "click", "ref": "e1"}, {"kind": "click", "ref": "e2"}],
                                      evaluate=dialog_on('.resolve("e2")'))
        self.assertEqual((result["completed"], result["error"]),
                         (1, "The page opened a confirm dialog. The remaining 1 step(s) did not run."))

    def test_a_dialog_after_the_last_step_leaves_every_step_done(self):
        result, _, _ = run_page_steps([{"kind": "click", "ref": "e1"}], page=helper.DialogOpened(dict(CONFIRM)))
        self.assertEqual((result["ok"], result["completed"], result["error"]),
                         (False, 1, "The page opened a confirm dialog."))

    def test_a_dialog_while_typing_says_how_much_was_typed(self):
        keys = []

        def evaluate(expression):
            if ".focusForKeys(" in expression:
                return {"focused": True, "multiline": False}
            if ".focusHolds(" in expression:
                if len(keys) >= 2:
                    raise helper.DialogOpened(dict(CONFIRM))
                return True
            return None

        result, sent, _ = run_page_steps([{"kind": "type", "ref": "e1", "text": "abcdef"}], evaluate=evaluate,
                                         after_key=lambda _client: keys.append(1))
        self.assertEqual((result["completed"], result["uncertain"], result["dialog"]), (0, False, CONFIRM))
        self.assertEqual(result["error"], "The page opened a confirm dialog while step 1 was typing, after 2 of 6 "
                                          "characters, so the rest was not typed.")
        self.assertEqual(len([p for m, p in sent if m == "Input.dispatchKeyEvent" and p["type"] == "keyDown"]), 2)

    def test_a_dialog_step_with_no_dialog_open_is_refused(self):
        result, _, _ = run_page_steps([{"kind": "click", "ref": "e1"}, {"kind": "dialog", "accept": True}])
        self.assertEqual(result, {"ok": False, "completed": 1, "uncertain": False,
                                  "error": "No dialog from your steps is open on this page, so there is nothing to answer."})


class ConversationTabTest(unittest.TestCase):
    """One command in a conversation's tab, with the display lock already held."""

    key = "a" * 64
    target = "1" * 32

    def run_in_tab(self, command, args=None, held=None, result=None, enable_error=None, dialogs=None,
                   hold=True, answer=None):
        client = Mock()
        calls = []

        def call(method, params=None, **_):
            calls.append(method)
            if method == "Target.attachToTarget":
                return {"sessionId": "s"}
            if method == "Target.getTargetInfo":
                return {"targetInfo": {"url": "https://example.test/", "title": "Example"}}
            if method == "Page.enable" and enable_error:
                raise enable_error
            return {}

        def answered(*_args):
            calls.append("answer")
            return answer

        client.call.side_effect = call
        client.dialogs = dialogs or {}
        with patch.object(helper, "scoped_target", return_value=self.target), \
                patch.object(helper, "held_dialog", return_value=held), \
                patch.object(helper, "answer_held_dialog", side_effect=answered) as answering, \
                patch.object(helper, "hold_dialog", return_value=hold) as holding, \
                patch.object(helper, "ensure_world"), \
                patch.object(helper, "run_page_command",
                             return_value=result or {"ok": True, "completed": 1}) as running:
            outcome = helper.run_in_tab(client, Path("scope"), self.key, command, args or {})
        return outcome, calls, answering, holding, running

    def test_a_held_dialog_refuses_everything_but_its_answer(self):
        for command, args in (("snapshot", {}), ("navigate", {"url": "https://example.test/"}),
                              ("act", {"actions": [{"kind": "click", "ref": "e1"}]})):
            with self.subTest(command=command):
                result, calls, _, _, running = self.run_in_tab(command, args, held=CONFIRM)
                self.assertEqual({key: result[key] for key in ("ok", "uncertain", "url", "title", "dialog")},
                                 {"ok": False, "uncertain": False, "url": "https://example.test/", "title": "Example",
                                  "dialog": CONFIRM})
                self.assertTrue(result["error"].startswith("A confirm dialog from your earlier step is still open"))
                self.assertEqual(result.get("completed"), 0 if command == "act" else None)
                self.assertNotIn("Target.attachToTarget", calls)
                running.assert_not_called()

    def test_a_held_dialog_still_lets_a_person_take_the_tab(self):
        result, calls, _, _, _ = self.run_in_tab("focus", held=CONFIRM)
        self.assertEqual(result, {"ok": True})
        self.assertIn("Target.activateTarget", calls)

    def test_an_answered_dialog_lets_the_rest_of_the_call_run(self):
        steps = [{"kind": "dialog", "accept": True}, {"kind": "click", "ref": "e1"}]
        result, calls, answering, _, running = self.run_in_tab(
            "act", {"actions": steps}, held=CONFIRM, result={"ok": True, "completed": 2})
        self.assertEqual(result, {"ok": True, "completed": 2})
        self.assertEqual(answering.call_args.args[1:], ("s", helper.dialog_socket(Path("scope"), self.key), steps[0]))
        self.assertLess(calls.index("answer"), calls.index("Page.enable"))
        running.assert_called_once_with(running.call_args.args[0], "s", "act", {"actions": steps[1:]}, 1)

    def test_an_answer_that_did_not_land_stops_the_call(self):
        lost = {"ok": False, "completed": 0, "uncertain": True, "fallback": "computer_act", "error": "lost"}
        result, calls, _, _, running = self.run_in_tab(
            "act", {"actions": [{"kind": "dialog", "accept": False}]}, held=CONFIRM, answer=lost)
        self.assertEqual(result, lost)
        self.assertNotIn("Page.enable", calls)
        running.assert_not_called()

    def test_a_page_that_does_not_answer_is_settled(self):
        result, _, _, _, running = self.run_in_tab("act", {"actions": [{"kind": "click", "ref": "e1"}]},
                                                   enable_error=TimeoutError("CDP call timed out: Page.enable"))
        self.assertEqual({key: result[key] for key in ("ok", "uncertain", "completed")},
                         {"ok": False, "uncertain": False, "completed": 0})
        self.assertIn("not responding", result["error"])
        running.assert_not_called()

    def test_a_dialog_a_step_opened_is_held_for_the_next_call(self):
        opened = {"ok": False, "uncertain": False, "completed": 1, "dialog": CONFIRM,
                  "error": "Step 1 (click) opened a confirm dialog."}
        for hold in (True, False):
            with self.subTest(hold=hold):
                result, _, _, holding, _ = self.run_in_tab(
                    "act", {"actions": [{"kind": "click", "ref": "e1"}]}, result=dict(opened),
                    dialogs={"s": CONFIRM}, hold=hold)
                holding.assert_called_once_with(holding.call_args.args[0], "s",
                                                helper.dialog_socket(Path("scope"), self.key), CONFIRM)
                if hold:
                    self.assertNotIn("forPerson", result["dialog"])
                    self.assertIn("answer it with a browser_act dialog step", result["error"])
                else:
                    self.assertTrue(result["dialog"]["forPerson"])
                    self.assertIn("stays for a person", result["error"])

    def test_a_dialog_seen_while_reading_stays_for_a_person(self):
        opened = {"ok": False, "uncertain": False, "dialog": CONFIRM,
                  "error": "The page opened a confirm dialog while the page was being read."}
        result, _, _, holding, _ = self.run_in_tab("snapshot", result=dict(opened), dialogs={"s": CONFIRM})
        holding.assert_not_called()
        self.assertTrue(result["dialog"]["forPerson"])

    def test_answering_listens_for_the_next_dialog_before_the_keeper_answers(self):
        client = Mock()
        order = []
        client.send.side_effect = lambda method, params=None, **kwargs: order.append(("send", method, kwargs.get("session_id")))
        client.call.side_effect = lambda method, params=None, **kwargs: order.append(("call", method)) or {}

        def ask(_path, request, _timeout_s=None):
            order.append(("ask", request))
            return {"ok": True}

        with patch.object(helper, "ask_dialog_keeper", side_effect=ask):
            self.assertIsNone(helper.answer_held_dialog(client, "s", Path("keeper"),
                                                        {"kind": "dialog", "accept": False, "text": "Ada"}))
        self.assertEqual(order, [("send", "Page.enable", "s"), ("call", "Target.getTargets"),
                                 ("ask", {"op": "answer", "accept": False, "promptText": "Ada"})])

    def test_an_answer_reports_a_gone_dialog_as_settled_and_a_lost_reply_as_uncertain(self):
        for reply, uncertain in ((None, False), ({"ok": False, "error": "closed"}, False),
                                 (OSError("reset"), True), ({"ok": False, "error": "failed"}, True)):
            with self.subTest(reply=reply), patch.object(
                    helper, "ask_dialog_keeper", **({"side_effect": reply} if isinstance(reply, Exception)
                                                    else {"return_value": reply})):
                result = helper.answer_held_dialog(Mock(), "s", Path("keeper"), {"kind": "dialog", "accept": True})
            self.assertEqual((result["ok"], result["completed"], result["uncertain"]), (False, 0, uncertain))
            self.assertEqual(result.get("fallback"), "computer_act" if uncertain else None)


def server_frame(message):
    """One unmasked text frame, as Chromium sends it."""
    payload = json.dumps(message).encode("utf-8")
    length = bytes([len(payload)]) if len(payload) < 126 else bytes([126]) + struct.pack("!H", len(payload))
    return b"\x81" + length + payload


def read_client_frame(sock):
    """One masked text frame from the helper, decoded."""
    def exact(size):
        data = b""
        while len(data) < size:
            chunk = sock.recv(size - len(data))
            if not chunk:
                raise RuntimeError("closed")
            data += chunk
        return data
    _, second = exact(2)
    length = second & 0x7F
    if length == 126:
        length = struct.unpack("!H", exact(2))[0]
    elif length == 127:
        length = struct.unpack("!Q", exact(8))[0]
    mask = exact(4)
    return json.loads(bytes(b ^ mask[i % 4] for i, b in enumerate(exact(length))))


class DialogKeeperTest(unittest.TestCase):
    """The keeper's loop, over a stand-in browser connection and any listening socket."""

    def keeper(self, seconds=5.0):
        browser, held = socket.socketpair()
        client = helper.CdpClient("ws://127.0.0.1/dialog")
        client._sock = held
        client._next_id = 1_000_000
        client.dialogs["s"] = dict(CONFIRM)
        listener = socket.create_server(("127.0.0.1", 0))
        directory = TemporaryDirectory()
        path = os.path.join(directory.name, "keeper")
        Path(path).write_text("")
        thread = threading.Thread(target=helper.hold_until_answered, daemon=True, args=(
            client, "s", listener, path, os.stat(path).st_ino, time.monotonic() + seconds))
        thread.start()
        for cleanup in (directory.cleanup, listener.close, held.close, browser.close):
            self.addCleanup(cleanup)
        browser.settimeout(5)
        return browser, listener, path, thread

    @staticmethod
    def ask(listener, request):
        with socket.create_connection(listener.getsockname(), timeout=5) as conn:
            helper.send_line(conn, request)
            return helper.read_line(conn)

    def answer(self, listener, request, replies):
        asking = threading.Thread(target=lambda: replies.append(self.ask(listener, request)), daemon=True)
        asking.start()
        return asking

    def test_the_keeper_describes_its_dialog_and_then_answers_it(self):
        browser, listener, path, thread = self.keeper()
        self.assertEqual(self.ask(listener, {"op": "describe"}), {"ok": True, "dialog": CONFIRM})
        self.assertEqual(self.ask(listener, {"op": "sing"}), {"ok": False, "error": "invalid"})
        replies = []
        asking = self.answer(listener, {"op": "answer", "accept": False, "promptText": "Ada"}, replies)
        request = read_client_frame(browser)
        self.assertEqual((request["method"], request["params"], request["sessionId"]),
                         ("Page.handleJavaScriptDialog", {"accept": False, "promptText": "Ada"}, "s"))
        browser.sendall(server_frame({"id": request["id"], "result": {}}))
        asking.join(5)
        thread.join(5)
        self.assertEqual(replies, [{"ok": True}])
        self.assertFalse(thread.is_alive())
        # The name is free for a keeper of the dialog the page may open next.
        self.assertFalse(os.path.exists(path))

    def test_a_dialog_closed_meanwhile_is_reported_as_closed(self):
        browser, listener, _, thread = self.keeper()
        replies = []
        asking = self.answer(listener, {"op": "answer", "accept": True}, replies)
        request = read_client_frame(browser)
        browser.sendall(server_frame({"id": request["id"], "error": {"code": -32602, "message": "No dialog is showing"}}))
        asking.join(5)
        thread.join(5)
        self.assertEqual(replies, [{"ok": False, "error": "closed"}])

    def test_the_keeper_stops_when_a_person_closes_the_dialog(self):
        browser, _, _, thread = self.keeper()
        browser.sendall(server_frame({"method": "Page.javascriptDialogClosed", "sessionId": "s",
                                      "params": {"result": True}}))
        thread.join(5)
        self.assertFalse(thread.is_alive())

    def test_the_keeper_stops_when_the_browser_goes_away_or_its_time_is_up(self):
        browser, _, _, thread = self.keeper()
        browser.close()
        thread.join(5)
        self.assertFalse(thread.is_alive())
        _, _, _, waiting = self.keeper(seconds=0.3)
        waiting.join(5)
        self.assertFalse(waiting.is_alive())


@unittest.skipUnless(sys.platform.startswith("linux") and hasattr(socket, "AF_UNIX"),
                     "the dialog keeper runs on the Linux computer")
class DialogKeeperProcessTest(unittest.TestCase):
    def test_a_keeper_process_holds_the_dialog_for_the_next_command(self):
        browser, held = socket.socketpair()
        self.addCleanup(browser.close)
        browser.settimeout(5)
        client = helper.CdpClient("ws://127.0.0.1/dialog")
        client._sock = held
        client._next_id = 7
        with TemporaryDirectory() as directory:
            path = Path(directory) / "keeper.dialog"
            self.assertTrue(helper.hold_dialog(client, "s", path, dict(CONFIRM)))
            # The command that saw the dialog ends here; its keeper keeps the connection open.
            held.close()
            self.assertEqual(helper.held_dialog(path), CONFIRM)
            replies = []
            asking = threading.Thread(daemon=True, target=lambda: replies.append(
                helper.ask_dialog_keeper(path, {"op": "answer", "accept": True}, 5)))
            asking.start()
            request = read_client_frame(browser)
            self.assertEqual((request["method"], request["params"], request["sessionId"]),
                             ("Page.handleJavaScriptDialog", {"accept": True}, "s"))
            self.assertGreater(request["id"], 7)
            browser.sendall(server_frame({"id": request["id"], "result": {}}))
            asking.join(5)
            self.assertEqual(replies, [{"ok": True}])
            self.assertFalse(path.exists())
            self.assertIsNone(helper.held_dialog(path))


class TabStreamTest(unittest.TestCase):
    base = "1" * 32
    popup = "2" * 32

    def stream(self):
        client = Mock()
        sent = []
        client._send_frame.side_effect = lambda payload: sent.append(__import__("json").loads(payload))
        viewer = Mock()
        stream = helper.TabStream(client, self.base, viewer)
        return stream, sent, viewer

    @staticmethod
    def viewer_messages(viewer):
        data = b"".join(call.args[0] for call in viewer.sendall.call_args_list)
        messages = []
        while data:
            length, kind = struct.unpack("!IB", data[:5])
            messages.append((kind, data[5:4 + length]))
            data = data[4 + length:]
        return messages

    def attach(self, stream, sent, target, session):
        attach = next(m for m in reversed(sent) if m["method"] == "Target.attachToTarget")
        self.assertEqual(attach["params"]["targetId"], target)
        stream.handle({"id": attach["id"], "result": {"sessionId": session}})

    def test_pointer_and_keys_map_to_the_frame_and_drop_anything_else(self):
        viewport = (1000.0, 500.0)
        self.assertEqual(
            helper.tab_input_command({"t": "mouse", "type": "mousePressed", "x": 0.5, "y": 2, "button": "left",
                                      "buttons": 1, "clickCount": 1}, viewport),
            ("Input.dispatchMouseEvent", {"x": 500.0, "y": 500.0, "modifiers": 0, "type": "mousePressed",
                                          "button": "left", "buttons": 1, "clickCount": 1}),
        )
        self.assertEqual(helper.tab_input_command({"t": "key", "type": "keyDown", "key": "a", "code": "KeyA",
                                                   "keyCode": 65, "text": "a"}, viewport)[1]["type"], "keyDown")
        self.assertEqual(helper.tab_input_command({"t": "key", "type": "keyDown", "key": "Tab", "code": "Tab",
                                                   "keyCode": 9}, viewport)[1]["type"], "rawKeyDown")
        self.assertEqual(helper.tab_input_command({"t": "text", "text": "hunter2"}, viewport),
                         ("Input.insertText", {"text": "hunter2"}))
        for event in (
            {"t": "mouse", "type": "mousePressed", "x": "1", "y": 0},
            {"t": "mouse", "type": "dragStart", "x": 0, "y": 0},
            {"t": "nav", "action": "location='https://evil.example'"},
            {"t": "eval", "expression": "1"},
            {"t": "text", "text": "x" * 32_001},
            "keyDown",
        ):
            self.assertIsNone(helper.tab_input_command(event, viewport))
        # No frame yet means no size to map a pointer to.
        self.assertIsNone(helper.tab_input_command({"t": "mouse", "type": "mouseMoved", "x": 0, "y": 0}, (0.0, 0.0)))

    def test_frames_reach_the_viewer_before_they_are_acknowledged(self):
        stream, sent, viewer = self.stream()
        stream.show(self.base)
        self.attach(stream, sent, self.base, "s1")
        self.assertIn({"method": "Page.startScreencast", "params": helper.TAB_STREAM_SCREENCAST,
                       "sessionId": "s1"}, [{k: m[k] for k in ("method", "params", "sessionId") if k in m} for m in sent])
        jpeg = b"\xff\xd8jpeg"
        stream.handle({"method": "Page.screencastFrame", "sessionId": "s1", "params": {
            "data": __import__("base64").b64encode(jpeg).decode(), "sessionId": 7,
            "metadata": {"deviceWidth": 800, "deviceHeight": 600}}})
        kind, payload = self.viewer_messages(viewer)[-1]
        self.assertEqual(kind, helper.TAB_STREAM_FRAME)
        header = struct.unpack("!H", payload[:2])[0]
        self.assertEqual(payload[2 + header:], jpeg)
        self.assertEqual(stream.viewport, (800.0, 600.0))
        self.assertEqual(sent[-1]["method"], "Page.screencastFrameAck")
        self.assertEqual(sent[-1]["params"], {"sessionId": 7})
        # Frames from another session are not this tab's.
        before = len(viewer.sendall.call_args_list)
        stream.handle({"method": "Page.screencastFrame", "sessionId": "other", "params": {"data": "", "sessionId": 8}})
        self.assertEqual(len(viewer.sendall.call_args_list), before)

    def test_a_sign_in_popup_is_shown_and_closing_it_returns_to_the_tab(self):
        stream, sent, _viewer = self.stream()
        stream.show(self.base)
        self.attach(stream, sent, self.base, "s1")
        # Another tab's popup is not followed.
        stream.handle({"method": "Target.targetCreated", "params": {"targetInfo": {
            "targetId": "3" * 32, "type": "page", "openerId": "4" * 32}}})
        self.assertEqual(stream.target, self.base)
        stream.handle({"method": "Target.targetCreated", "params": {"targetInfo": {
            "targetId": self.popup, "type": "page", "openerId": self.base}}})
        self.attach(stream, sent, self.popup, "s2")
        self.assertEqual((stream.target, stream.session), (self.popup, "s2"))
        self.assertIn({"method": "Page.stopScreencast", "sessionId": "s1"},
                      [{k: m[k] for k in ("method", "sessionId") if k in m} for m in sent])
        self.assertTrue(stream.handle({"method": "Target.targetDestroyed", "params": {"targetId": self.popup}}))
        self.attach(stream, sent, self.base, "s3")
        self.assertEqual(stream.target, self.base)
        self.assertFalse(stream.handle({"method": "Target.targetDestroyed", "params": {"targetId": self.base}}))

    def test_server_refuses_arguments_outside_its_socket_directory(self):
        self.assertEqual(helper.serve_tab_stream("/tmp/elsewhere", "a" * 64), 2)
        self.assertEqual(helper.serve_tab_stream("/home/sockets/tab-1-x", "a" * 64), 2)
        self.assertEqual(helper.serve_tab_stream("/tmp/screens/sockets/tab-1-x", "not-a-key"), 2)


if __name__ == "__main__":
    unittest.main()
