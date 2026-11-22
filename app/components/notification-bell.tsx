import "@knocklabs/react/dist/index.css";

import {
  KnockFeedProvider,
  KnockProvider,
  NotificationFeedPopover,
  NotificationIconButton,
} from "@knocklabs/react";
import { Bell } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useContext,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useNavigate } from "react-router";

import type { NotificationFeedProps } from "~/lib/notification-feed.server";

// ─── Notification bell ───
// Knock's prebuilt bell and popover, in the sidebar header. Knock's React SDK
// only runs in the browser, so its providers mount after hydration: server
// and hydration renders show a static bell with the same footprint, then the
// sidebar remounts once inside the providers. `<Outlet />` sits outside the
// boundary and is never remounted. The popover is restyled only through
// Knock's `--rnf-*` variables in app.css (`.cadence-knock`).

type BellState = "none" | "static" | "live";

const BellContext = createContext<BellState>("none");

// False during SSR and the hydration render, true afterwards.
function useHydrated() {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false
  );
}

function subscribeToNothing() {
  return () => {};
}

// Wraps only the sidebar. `feed` is null for a signed-out visitor, who gets
// no bell.
export function NotificationFeedBoundary({
  feed,
  children,
}: {
  feed: NotificationFeedProps | null;
  children: ReactNode;
}) {
  const isHydrated = useHydrated();
  if (!feed) return <BellContext value="none">{children}</BellContext>;
  if (!isHydrated) return <BellContext value="static">{children}</BellContext>;
  return (
    <KnockProvider
      apiKey={feed.apiKey}
      user={{ id: feed.userId }}
      userToken={feed.userToken}
    >
      <KnockFeedProvider feedId={feed.feedChannelId}>
        <BellContext value="live">{children}</BellContext>
      </KnockFeedProvider>
    </KnockProvider>
  );
}

export function NotificationBell() {
  const state = useContext(BellContext);
  if (state === "none") return null;
  if (state === "static") return <StaticBell />;
  return <LiveBell />;
}

function LiveBell() {
  const [isOpen, setIsOpen] = useState(false);
  const buttonReference = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();

  return (
    <div className="cadence-knock">
      <NotificationIconButton
        ref={buttonReference}
        onClick={() => setIsOpen((wasOpen) => !wasOpen)}
      />
      <NotificationFeedPopover
        buttonRef={buttonReference}
        isVisible={isOpen}
        onClose={() => setIsOpen(false)}
        placement="right-start"
        // Knock marks the Notification read before calling this. Its
        // default would then reload the page at the url; navigating in the
        // app keeps the page shell mounted instead.
        onNotificationClick={(item) => {
          const url = item.data?.url;
          if (typeof url !== "string") return;
          setIsOpen(false);
          navigate(url);
        }}
      />
    </div>
  );
}

function StaticBell() {
  // Same footprint as Knock's 32px icon button, so nothing shifts.
  return (
    <span
      className="inline-flex size-8 items-center justify-center opacity-40"
      aria-hidden
    >
      <Bell className="size-4" />
    </span>
  );
}
