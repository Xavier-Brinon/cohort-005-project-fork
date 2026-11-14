// PROTOTYPE, throwaway (branch prototype/notification-inbox). Never merge.
// Three variants of in-app Notifications, switched with ?variant=A|B|C:
//   A  Prebuilt Knock popover from a bell in the sidebar header.
//   B  "Notifications" nav item with unread badge, opening a <dialog> drawer
//      with Cadence-styled rows (headless Knock hooks).
//   C  Push-first: live arrivals as sonner toasts, plus an inline list that
//      expands inside the sidebar footer.
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  KnockFeedProvider,
  KnockProvider,
  NotificationFeedPopover,
  NotificationIconButton,
  useKnockFeed,
} from "@knocklabs/react";
import type { FeedItem } from "@knocklabs/client";
import "@knocklabs/react/dist/index.css";
import { toast } from "sonner";
import { Bell, MessageSquare, Receipt, Reply, X } from "lucide-react";
import { cn } from "~/lib/utils";

export type KnockClientProps = {
  apiKey: string;
  feedId: string;
  userId: string;
  userToken: string;
  signedAt: string;
};

export const VARIANTS = [
  { key: "A", name: "Prebuilt popover" },
  { key: "B", name: "Drawer + nav badge" },
  { key: "C", name: "Toasts + inline list" },
] as const;
type VariantKey = (typeof VARIANTS)[number]["key"];

export function useVariant(): VariantKey {
  const [params] = useSearchParams();
  const v = params.get("variant");
  return v === "B" || v === "C" ? v : "A";
}

// True only after hydration; false during SSR and the hydration render.
function useHydrated() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

const ReadyContext = createContext(false);

// Wraps ONLY the sidebar. Before hydration it renders children bare, so the
// server HTML never contains Knock. After hydration the sidebar remounts once
// inside the providers; the page content (<Outlet />) is untouched.
export function NotificationsBoundary({
  knock,
  children,
}: {
  knock: KnockClientProps | null;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  if (!hydrated || !knock) {
    return <ReadyContext value={false}>{children}</ReadyContext>;
  }
  return (
    <KnockProvider
      apiKey={knock.apiKey}
      user={{ id: knock.userId }}
      userToken={knock.userToken}
    >
      <KnockFeedProvider feedId={knock.feedId}>
        <ReadyContext value={true}>{children}</ReadyContext>
      </KnockFeedProvider>
    </KnockProvider>
  );
}

const useReady = () => useContext(ReadyContext);

type ItemData = {
  type?: string;
  title?: string;
  body?: string;
  url?: string;
  outcome?: string;
};

const TYPE_META: Record<string, { label: string; icon: ReactNode }> = {
  "refund-request-decided": {
    label: "Refund Request decided",
    icon: <Receipt className="size-4" />,
  },
  "refund-request-opened": {
    label: "New Refund Request",
    icon: <Receipt className="size-4" />,
  },
  "lesson-question-posted": {
    label: "New Lesson Question",
    icon: <MessageSquare className="size-4" />,
  },
  "lesson-reply-posted": {
    label: "New Lesson Reply",
    icon: <Reply className="size-4" />,
  },
};

function plain(md = "") {
  return md.replace(/\*\*|_/g, "");
}

function timeAgo(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function useFeed() {
  const { feedClient, useFeedStore } = useKnockFeed();
  const items = useFeedStore((s) => s.items);
  const unread = useFeedStore((s) => s.metadata.unread_count);
  const unseen = useFeedStore((s) => s.metadata.unseen_count);
  const loading = useFeedStore((s) => s.loading);
  useEffect(() => {
    feedClient.fetch();
  }, [feedClient]);
  return { feedClient, items, unread, unseen, loading };
}

function NotificationRow({
  item,
  onOpen,
  compact = false,
}: {
  item: FeedItem;
  onOpen: (item: FeedItem) => void;
  compact?: boolean;
}) {
  const d = (item.data ?? {}) as ItemData;
  const meta = TYPE_META[d.type ?? ""];
  const unread = !item.read_at;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item)}
        className={cn(
          "flex w-full gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-sidebar-accent",
          unread && "bg-primary/5"
        )}
      >
        <span className="mt-0.5 text-sidebar-foreground/60">{meta?.icon}</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              {d.title ?? meta?.label}
            </span>
            {unread && (
              <span
                className="size-2 shrink-0 rounded-full bg-primary"
                aria-label="Unread"
              />
            )}
          </span>
          {!compact && (
            <span className="mt-0.5 line-clamp-2 block text-xs text-sidebar-foreground/70">
              {plain(d.body)}
            </span>
          )}
          <span className="mt-0.5 block text-xs text-sidebar-foreground/50">
            {timeAgo(item.inserted_at)}
          </span>
        </span>
      </button>
    </li>
  );
}

function useOpenItem() {
  const navigate = useNavigate();
  const { feedClient } = useKnockFeed();
  return (item: FeedItem) => {
    feedClient.markAsRead(item);
    const url = (item.data as ItemData | null)?.url;
    if (url) navigate(url);
  };
}

function EmptyState() {
  return (
    <div className="px-3 py-8 text-center text-sm text-sidebar-foreground/60">
      <Bell className="mx-auto mb-2 size-5 opacity-50" />
      You're all caught up.
    </div>
  );
}

// ---- Variant A: prebuilt Knock popover, bell in the sidebar header --------

function VariantAHeader() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div className="cadence-knock">
      <NotificationIconButton ref={ref} onClick={() => setOpen((o) => !o)} />
      <NotificationFeedPopover
        buttonRef={ref}
        isVisible={open}
        onClose={() => setOpen(false)}
        placement="right-start"
      />
    </div>
  );
}

// ---- Variant B: nav item with badge + <dialog> drawer --------------------

function VariantBNav() {
  const { items, unread, feedClient } = useFeed();
  const openItem = useOpenItem();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"unread" | "all">("unread");
  const [expanded, setExpanded] = useState(false);

  // Light-dismiss fallback where <dialog closedby> is unsupported.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;
    const onClick = (e: MouseEvent) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside =
        r.top <= e.clientY &&
        e.clientY <= r.top + r.height &&
        r.left <= e.clientX &&
        e.clientX <= r.left + r.width;
      if (!inside) dialog.close();
    };
    dialog.addEventListener("click", onClick);
    return () => dialog.removeEventListener("click", onClick);
  }, []);

  const shown = tab === "unread" ? items.filter((i) => !i.read_at) : items;

  return (
    <>
      <button
        type="button"
        aria-controls="notifications-drawer"
        aria-expanded={expanded}
        onClick={() => {
          dialogRef.current?.showModal();
          setExpanded(true);
        }}
        className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Bell className="size-4" />
        Notifications
        {unread > 0 && (
          <span
            className="ml-auto rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground"
            aria-label={`${unread} unread`}
          >
            {unread}
          </span>
        )}
      </button>
      <dialog
        ref={dialogRef}
        id="notifications-drawer"
        aria-labelledby="notifications-drawer-title"
        {...({ closedby: "any" } as object)}
        onClose={() => setExpanded(false)}
        className="m-0 ml-auto h-dvh max-h-none w-[min(24rem,90vw)] border-l border-sidebar-border bg-sidebar p-0 text-sidebar-foreground backdrop:bg-black/40"
      >
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4">
          <h2 id="notifications-drawer-title" className="font-semibold">
            Notifications
          </h2>
          <button
            type="button"
            autoFocus
            aria-label="Close notifications"
            onClick={() => dialogRef.current?.close()}
            className="rounded-md p-1 hover:bg-sidebar-accent"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="flex items-center gap-2 border-b border-sidebar-border px-4 py-2 text-sm">
          {(["unread", "all"] as const).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tab === t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-2 py-1 capitalize",
                tab === t ? "bg-sidebar-accent font-medium" : "opacity-70"
              )}
            >
              {t}
            </button>
          ))}
          <button
            type="button"
            onClick={() => feedClient.markAllAsRead()}
            className="ml-auto text-xs text-primary hover:underline"
          >
            Mark all read
          </button>
        </div>
        {shown.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-1 p-2">
            {shown.map((item) => (
              <NotificationRow
                key={item.id}
                item={item}
                onOpen={(i) => {
                  dialogRef.current?.close();
                  openItem(i);
                }}
              />
            ))}
          </ul>
        )}
      </dialog>
    </>
  );
}

// ---- Variant C: toasts on arrival + inline list in the footer ------------

function VariantCFooter() {
  const { items, unread, feedClient } = useFeed();
  const openItem = useOpenItem();

  useEffect(() => {
    const onRealtime = ({ items }: { items: FeedItem[] }) => {
      for (const item of items) {
        const d = (item.data ?? {}) as ItemData;
        toast(d.title ?? "New Notification", {
          description: plain(d.body),
          action: { label: "Open", onClick: () => openItem(item) },
        });
      }
    };
    feedClient.on("items.received.realtime", onRealtime);
    return () => feedClient.off("items.received.realtime", onRealtime);
  }, [feedClient, openItem]);

  return (
    <details className="group px-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:bg-sidebar-accent">
        <Bell className="size-4" />
        {unread > 0 ? `${unread} new` : "No new notifications"}
      </summary>
      <div className="max-h-64 overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="space-y-1 py-1">
            {items.slice(0, 6).map((item) => (
              <NotificationRow key={item.id} item={item} onOpen={openItem} compact />
            ))}
          </ul>
        )}
        {unread > 0 && (
          <button
            type="button"
            onClick={() => feedClient.markAllAsRead()}
            className="mb-2 px-3 text-xs text-primary hover:underline"
          >
            Mark all read
          </button>
        )}
      </div>
    </details>
  );
}

// ---- Slots the sidebar mounts --------------------------------------------

function StaticBell() {
  // Same footprint as the live bell, so nothing shifts after hydration.
  return (
    <span className="inline-flex size-8 items-center justify-center opacity-40" aria-hidden>
      <Bell className="size-4" />
    </span>
  );
}

export function NotificationsHeaderSlot() {
  const ready = useReady();
  const variant = useVariant();
  if (variant !== "A") return null;
  return ready ? <VariantAHeader /> : <StaticBell />;
}

export function NotificationsNavSlot() {
  const ready = useReady();
  const variant = useVariant();
  if (variant !== "B" || !ready) return null;
  return <VariantBNav />;
}

export function NotificationsFooterSlot() {
  const ready = useReady();
  const variant = useVariant();
  if (variant !== "C" || !ready) return null;
  return <VariantCFooter />;
}
