import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PurchaseKind } from "~/lib/refunds.server";

// ─── In-app Notifications ───
// Knock delivers every Notification (docs/adr/0013). This module is the one
// seam the rest of Cadence talks to, mirroring the email `MailTransport` seam
// in mailer.server.ts:
//
// - Domain writes return Notification intents and mark-read intents.
// - A route action hands that result to `deliver`, after the write has
//   committed, which applies the central rules below and calls a `Notifier`.
// - The default `Notifier` is Knock when KNOCK_SECRET_API_KEY is set, and the
//   `.outbox/notifications/` JSON fallback otherwise. Tests use `fakeNotifier`.
//
// See GLOSSARY.md for Notification, Seen Notification and Read Notification.

// ─── Notification types ───
// One entry per Knock workflow (`.knock/workflows/<type>/`). The value is the
// trigger `data` that workflow's template reads. Add a type here to add one.

export type NotificationData = {
  "refund-request-opened": {
    refundRequestId: number;
    buyerName: string;
    courseTitle: string;
    purchaseKind: PurchaseKind;
    reasonExcerpt: string;
    url: string;
  };
  // One type with two outcomes: the template branches on `decision`.
  "refund-request-decided": {
    decision: "approved" | "declined";
    courseTitle: string;
    note: string | null;
    purchaseKind: PurchaseKind;
    url: string;
  };
};

export type NotificationType = keyof NotificationData;

// The trigger `data` field that names each type's subject, so `markRead` can
// find every Notification about one subject once it is dealt with elsewhere.
const SUBJECT_KEYS = {
  "refund-request-opened": "refundRequestId",
} as const satisfies {
  [T in NotificationType]?: keyof NotificationData[T];
};

export type MarkableType = keyof typeof SUBJECT_KEYS;

// A person as Knock sees them, identified inline at trigger time. Their Knock
// user id is `String(id)`.
export type Person = { id: number; name: string };

export type Notification<T extends NotificationType> = {
  actor: Person;
  recipients: Person[];
  data: NotificationData[T];
};

export type NotifyIntent = {
  [T in NotificationType]: { type: T } & Notification<T>;
}[NotificationType];

export type MarkReadIntent = { type: MarkableType; subjectId: number };

// What a domain write returns for `deliver`. Both lists are optional, so a
// write result can be passed straight in.
export type Deliverable = {
  notify?: readonly NotifyIntent[];
  markRead?: readonly MarkReadIntent[];
};

// ─── Notifier ───

export interface Notifier {
  // Sends one Notification of `type` to each recipient.
  notify<T extends NotificationType>(
    type: T,
    notification: Notification<T>
  ): Promise<void>;
  // Marks every Notification of `type` whose trigger data carries
  // `subjectId` as seen and read, for every recipient.
  markRead(type: MarkableType, subjectId: number): Promise<void>;
}

export type KnockConfig = {
  secretKey: string;
  // The in-app feed channel (`cadence-in-app`) that `markRead` updates.
  feedChannelId: string | undefined;
};

export function knockNotifier(config: KnockConfig): Notifier {
  // Imported lazily: `new Knock()` throws without a key, and tests and
  // outbox mode never need the SDK at all.
  let knockClient: Promise<import("@knocklabs/node").Knock> | undefined;
  function client() {
    knockClient ??= import("@knocklabs/node").then(
      ({ default: Knock }) =>
        // Retries would outlive `deliver`'s timeout, so there are none.
        new Knock({ apiKey: config.secretKey, maxRetries: 0, timeout: 3000 })
    );
    return knockClient;
  }

  return {
    async notify(type, { actor, recipients, data }) {
      const knock = await client();
      await knock.workflows.trigger(type, {
        actor: knockPerson(actor),
        recipients: recipients.map(knockPerson),
        data,
      });
    },

    async markRead(type, subjectId) {
      const { feedChannelId } = config;
      if (!feedChannelId) {
        throw new Error("KNOCK_FEED_CHANNEL_ID is not set.");
      }
      const knock = await client();
      const filter = {
        workflows: [type],
        // Knock takes the trigger data filter as a JSON string.
        trigger_data: JSON.stringify({ [SUBJECT_KEYS[type]]: subjectId }),
      };
      // Knock's read status never sets seen_at, so mark both, or the unseen
      // badge would stay lit.
      await knock.channels.bulk.updateMessageStatus(
        feedChannelId,
        "seen",
        filter
      );
      await knock.channels.bulk.updateMessageStatus(
        feedChannelId,
        "read",
        filter
      );
    },
  };
}

function knockPerson(person: Person) {
  return { id: String(person.id), name: person.name };
}

export function outboxNotifier(directory: string): Notifier {
  function write(
    entry: { operation: "notify" | "markRead"; type: NotificationType } & Record<
      string,
      unknown
    >
  ) {
    mkdirSync(directory, { recursive: true });
    // A notify and a markRead can land in the same millisecond.
    const file = join(
      directory,
      `${Date.now()}-${entry.operation}-${entry.type}-${randomUUID()}.json`
    );
    writeFileSync(file, JSON.stringify(entry, null, 2));
  }

  return {
    async notify(type, notification) {
      write({ operation: "notify", type, ...notification });
    },
    async markRead(type, subjectId) {
      write({ operation: "markRead", type, subjectId });
    },
  };
}

export type FakeNotifier = Notifier & {
  sent: NotifyIntent[];
  marked: MarkReadIntent[];
};

// Records every call, for tests.
export function fakeNotifier(): FakeNotifier {
  const sent: NotifyIntent[] = [];
  const marked: MarkReadIntent[] = [];
  return {
    sent,
    marked,
    async notify(type, notification) {
      // Rebuilding the intent from `type` loses the link between `type` and
      // `data` that the generic signature guarantees; it holds here.
      sent.push({ type, ...notification } as NotifyIntent);
    },
    async markRead(type, subjectId) {
      marked.push({ type, subjectId });
    },
  };
}

export function defaultNotifier(): Notifier {
  const secretKey = process.env.KNOCK_SECRET_API_KEY;
  return secretKey
    ? knockNotifier({
        secretKey,
        feedChannelId: process.env.KNOCK_FEED_CHANNEL_ID,
      })
    : outboxNotifier(join(".outbox", "notifications"));
}

// ─── Delivery ───
// The central rules, applied here and never at call sites:
// - Nobody is notified about their own action: the actor is dropped from the
//   recipients, and nothing is sent when nobody is left.
// - Each call is awaited with a timeout. Every failure, the timeout included,
//   is logged and never thrown, so a Notification never costs the write.
// - Call it only after the domain write has committed, never inside a
//   transaction.

export const DELIVERY_TIMEOUT_MS = 3000;

export async function deliver(
  deliverable: Deliverable,
  notifier: Notifier = defaultNotifier(),
  timeoutMs: number = DELIVERY_TIMEOUT_MS
): Promise<void> {
  const calls: { label: string; run: () => Promise<void> }[] = [];

  for (const intent of deliverable.notify ?? []) {
    const recipients = intent.recipients.filter(
      (recipient) => recipient.id !== intent.actor.id
    );
    if (recipients.length === 0) continue;
    calls.push({
      label: `notify ${intent.type}`,
      run: () => sendIntent(notifier, { ...intent, recipients }),
    });
  }

  for (const { type, subjectId } of deliverable.markRead ?? []) {
    calls.push({
      label: `markRead ${type} ${subjectId}`,
      run: () => notifier.markRead(type, subjectId),
    });
  }

  await Promise.all(
    calls.map(({ label, run }) => withTimeout(label, run, timeoutMs))
  );
}

function sendIntent(notifier: Notifier, intent: NotifyIntent): Promise<void> {
  const { type, ...notification } = intent;
  return notifier.notify(type, notification);
}

async function withTimeout(
  label: string,
  run: () => Promise<void>,
  timeoutMs: number
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    await Promise.race([run(), timeout]);
  } catch (error) {
    console.error(`Notification ${label} failed:`, error);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Excerpts ───

export const EXCERPT_LENGTH = 140;

// Cuts free text to about 140 characters for a Notification, on one line.
export function excerpt(text: string, length: number = EXCERPT_LENGTH): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine.length <= length) return oneLine;
  return `${oneLine.slice(0, length - 1).trimEnd()}…`;
}
