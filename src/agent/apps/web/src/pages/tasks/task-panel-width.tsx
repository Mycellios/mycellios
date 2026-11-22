import { useLingui } from "@lingui/react/macro";
import { type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";

/** Device-local, like the chat's own side panel width. */
export const TASK_PANEL_WIDTH_KEY = "mycellios:tasks:panel-width";
export const TASK_PANEL_MIN_WIDTH = 320;
export const TASK_PANEL_DEFAULT_WIDTH = 420;
/** The task list keeps at least this much room beside the panel. */
export const TASK_LIST_MIN_WIDTH = 320;
const STEP = 32;

/** The widest panel that still leaves the list its room; never narrower than the panel's minimum. */
export function taskPanelMaxWidth(bodyWidth: number) {
  return Math.max(TASK_PANEL_MIN_WIDTH, Math.floor(bodyWidth) - TASK_LIST_MIN_WIDTH);
}

export function clampTaskPanelWidth(width: number, bodyWidth: number) {
  if (!Number.isFinite(width)) return TASK_PANEL_DEFAULT_WIDTH;
  const max = bodyWidth > 0 ? taskPanelMaxWidth(bodyWidth) : Number.POSITIVE_INFINITY;
  return Math.round(Math.min(max, Math.max(TASK_PANEL_MIN_WIDTH, width)));
}

function savedWidth() {
  try {
    const saved = Number(localStorage.getItem(TASK_PANEL_WIDTH_KEY));
    if (Number.isFinite(saved) && saved >= TASK_PANEL_MIN_WIDTH) return saved;
  } catch {
    /* Storage may be disabled; the default width still works. */
  }
  return TASK_PANEL_DEFAULT_WIDTH;
}

/**
 * The detail panel's width: what the person chose on this device, kept within the room the
 * Tasks page has now. The choice itself is kept, so a wider window gets it back.
 */
export function useTaskPanelWidth(body: RefObject<HTMLElement | null>) {
  const [preferred, setPreferred] = useState(savedWidth);
  const [bodyWidth, setBodyWidth] = useState(0);
  useEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () => setBodyWidth(element.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [body]);
  useEffect(() => {
    try {
      localStorage.setItem(TASK_PANEL_WIDTH_KEY, String(preferred));
    } catch {
      /* Storage may be disabled; the width lasts for this visit. */
    }
  }, [preferred]);
  const width = clampTaskPanelWidth(preferred, bodyWidth);
  return {
    width,
    max: bodyWidth > 0 ? taskPanelMaxWidth(bodyWidth) : Math.max(width, TASK_PANEL_DEFAULT_WIDTH),
    /** Sets a width the person chose, kept within the room there is now. */
    resize: (next: number) => setPreferred(clampTaskPanelWidth(next, bodyWidth)),
  };
}

/**
 * The panel's edge: drag it, or focus it and use the arrow keys, Home and End. The panel sits
 * at the inline end, so moving the edge toward the list widens it in either direction of text.
 */
export function TaskPanelResizer({
  width,
  max,
  onResize,
}: {
  width: number;
  max: number;
  onResize: (width: number) => void;
}) {
  const { t } = useLingui();
  const drag = useRef<{ x: number; width: number; direction: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const direction = () => (document.documentElement.dir === "rtl" ? -1 : 1);
  function stop(event: PointerEvent<HTMLHRElement>) {
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return (
    <hr
      tabIndex={0}
      aria-label={t`Resize panel`}
      aria-orientation="vertical"
      aria-valuemin={TASK_PANEL_MIN_WIDTH}
      aria-valuemax={max}
      aria-valuenow={width}
      data-dragging={dragging || undefined}
      className="rk-task-resizer"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { x: event.clientX, width, direction: direction() };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (drag.current)
          onResize(drag.current.width + (drag.current.x - event.clientX) * drag.current.direction);
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
          event.preventDefault();
          onResize(width + (event.key === "ArrowLeft" ? STEP : -STEP) * direction());
        } else if (event.key === "Home") {
          event.preventDefault();
          onResize(TASK_PANEL_MIN_WIDTH);
        } else if (event.key === "End") {
          event.preventDefault();
          onResize(max);
        }
      }}
    />
  );
}
