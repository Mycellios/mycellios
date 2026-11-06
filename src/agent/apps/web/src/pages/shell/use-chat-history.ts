import { useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** Back/forward stays inside chats visited in this workspace; it never leaves the app. */
export function useChatHistory() {
  const { pathname, search } = useLocation();
  const destination = pathname + search;
  const navigate = useNavigate();
  const [history, setHistory] = useState({ paths: [destination], index: 0 });
  const pending = useRef<number | null>(null);
  useLayoutEffect(() => {
    const target = pending.current;
    pending.current = null;
    setHistory(current => {
      if (target !== null && current.paths[target] === destination) return { ...current, index: target };
      if (current.paths[current.index] === destination) return current;
      const paths = [...current.paths.slice(0, current.index + 1), destination].slice(-50);
      return { paths, index: paths.length - 1 };
    });
  }, [destination]);
  const move = (index: number) => {
    const destination = history.paths[index];
    if (!destination || pending.current !== null) return;
    pending.current = index;
    navigate(destination);
  };
  return {
    canBack: history.index > 0,
    canForward: history.index < history.paths.length - 1,
    back: () => move(history.index - 1),
    forward: () => move(history.index + 1),
  };
}
