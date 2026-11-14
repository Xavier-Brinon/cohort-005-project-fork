// PROTOTYPE, throwaway (branch prototype/notification-inbox). Never merge.
// Floating bar: cycle ?variant= with arrows (or ← →), send a sample
// Notification of each first-ship type to yourself, and see the state the
// prototype is checking (hydrated, token signed in the loader).
import { useEffect, useSyncExternalStore } from "react";
import { useFetcher, useNavigate, useLocation } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Variant = { key: string; name: string };

const SEND_TYPES = [
  ["refund-request-decided", "Refund decided"],
  ["refund-request-opened", "Refund opened"],
  ["lesson-question-posted", "Lesson Question"],
  ["lesson-reply-posted", "Lesson Reply"],
] as const;

export function PrototypeSwitcher({
  variants,
  current,
  tokenSignedAt,
}: {
  variants: readonly Variant[];
  current: string;
  tokenSignedAt: string | null;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const fetcher = useFetcher<{ ok: boolean; type: string; error?: string }>();
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current)
  );

  function go(delta: number) {
    const next = variants[(index + delta + variants.length) % variants.length];
    const params = new URLSearchParams(location.search);
    params.set("variant", next.key);
    navigate({ search: params.toString() }, { replace: true, preventScrollReset: true });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      )
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (import.meta.env.PROD) return null;

  const v = variants[index];
  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-1 rounded-2xl bg-neutral-900 px-3 py-2 text-xs text-white shadow-xl ring-2 ring-fuchsia-500">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => go(-1)} aria-label="Previous variant" className="rounded p-1 hover:bg-white/10">
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-44 text-center font-semibold">
          PROTOTYPE {v.key} ({v.name})
        </span>
        <button type="button" onClick={() => go(1)} aria-label="Next variant" className="rounded p-1 hover:bg-white/10">
          <ChevronRight className="size-4" />
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1">
        <span className="opacity-60">Send me:</span>
        {SEND_TYPES.map(([type, label]) => (
          <fetcher.Form key={type} method="post" action="/api/prototype-notify">
            <input type="hidden" name="type" value={type} />
            <button type="submit" className="rounded bg-white/10 px-2 py-0.5 hover:bg-white/20">
              {label}
            </button>
          </fetcher.Form>
        ))}
      </div>
      <div className="opacity-60">
        hydrated: {String(hydrated)} · token signed in loader:{" "}
        {tokenSignedAt ? new Date(tokenSignedAt).toLocaleTimeString() : "none"} ·
        last send:{" "}
        {fetcher.state !== "idle"
          ? "sending…"
          : fetcher.data
            ? fetcher.data.ok
              ? `${fetcher.data.type} sent`
              : `FAILED: ${fetcher.data.error}`
            : "none"}
      </div>
    </div>
  );
}
