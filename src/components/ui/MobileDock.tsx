import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useVisualViewport } from "@/lib/useVisualViewport";

type DockContextValue = {
  occupied: boolean;
  occupy: () => () => void;
};

const DockContext = createContext<DockContextValue>({
  occupied: false,
  occupy: () => () => {},
});

export function DockProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const occupy = useCallback(() => {
    setCount((n) => n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      setCount((n) => Math.max(0, n - 1));
    };
  }, []);
  const value = useMemo(() => ({ occupied: count > 0, occupy }), [count, occupy]);
  return <DockContext.Provider value={value}>{children}</DockContext.Provider>;
}

export function useDockOccupied() {
  return useContext(DockContext).occupied;
}

function useComposerOccupy(active: boolean) {
  const { occupy } = useContext(DockContext);
  useLayoutEffect(() => {
    if (!active) return;
    return occupy();
  }, [active, occupy]);
}

export function MobileDock({
  children,
  className = "",
  enabled = true,
  role = "nav",
}: {
  children: ReactNode;
  className?: string;
  enabled?: boolean;
  role?: "nav" | "composer";
}) {
  const view = useVisualViewport();
  const nodeRef = useRef<HTMLDivElement>(null);
  const show = Boolean(enabled && view.mobile && typeof document !== "undefined");
  useComposerOccupy(role === "composer" && show);

  useLayoutEffect(() => {
    if (!show) return;
    const node = nodeRef.current;
    if (!node) return;
    const apply = () => {
      document.documentElement.style.setProperty(
        "--rita-dock",
        `${Math.round(node.getBoundingClientRect().height)}px`,
      );
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(node);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--rita-dock");
    };
  }, [show, children, view.keyboard, view.height]);

  if (!show) return null;

  return createPortal(
    <div
      ref={nodeRef}
      className={`fixed box-border overflow-x-clip bg-white ${
        role === "composer" ? "z-[60]" : "z-40"
      } ${className}`}
      style={{
        left: view.offsetLeft,
        width: view.width,
        maxWidth: view.width,
        top: view.offsetTop + view.height,
        transform: "translateY(-100%)",
        paddingBottom: view.keyboard ? 8 : undefined,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

export function ResponsiveDock({
  children,
  className = "",
  mobileClassName = "",
}: {
  children: ReactNode;
  className?: string;
  mobileClassName?: string;
}) {
  const view = useVisualViewport();
  if (view.mobile) {
    return (
      <MobileDock className={mobileClassName || className} enabled role="composer">
        {children}
      </MobileDock>
    );
  }
  return <div className={className}>{children}</div>;
}
