import { useEffect, useState } from "react";

function reading() {
  const view = typeof window === "undefined" ? null : window.visualViewport;
  const focused =
    typeof document !== "undefined" &&
    Boolean(
      document.activeElement &&
        (document.activeElement.tagName === "INPUT" ||
          document.activeElement.tagName === "TEXTAREA" ||
          (document.activeElement as HTMLElement).isContentEditable),
    );
  const height = view?.height ?? (typeof window === "undefined" ? 800 : window.innerHeight);
  const inner = typeof window === "undefined" ? 800 : window.innerHeight;
  return {
    keyboard: focused || inner - height > 60,
    offsetLeft: view?.offsetLeft ?? 0,
    offsetTop: view?.offsetTop ?? 0,
    width: view?.width ?? (typeof window === "undefined" ? 390 : window.innerWidth),
    height,
    mobile: typeof window === "undefined" ? true : window.matchMedia("(max-width: 767px)").matches,
  };
}

export function useVisualViewport() {
  const [state, setState] = useState(reading);

  useEffect(() => {
    const view = window.visualViewport;
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setState(reading());
    view?.addEventListener("resize", sync);
    view?.addEventListener("scroll", sync);
    window.addEventListener("focusin", sync);
    window.addEventListener("focusout", sync);
    mq.addEventListener("change", sync);
    sync();
    return () => {
      view?.removeEventListener("resize", sync);
      view?.removeEventListener("scroll", sync);
      window.removeEventListener("focusin", sync);
      window.removeEventListener("focusout", sync);
      mq.removeEventListener("change", sync);
    };
  }, []);

  return state;
}
