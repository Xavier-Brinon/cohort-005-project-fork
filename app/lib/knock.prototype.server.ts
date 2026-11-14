// PROTOTYPE, throwaway (branch prototype/notification-inbox). Never merge.
// Question: can React Router sign a Knock user token in a loader and mount the
// Knock inbox only after hydration, with real-time delivery?
import Knock, { signUserToken } from "@knocklabs/node";

const knock = new Knock({ apiKey: process.env.KNOCK_SECRET_API_KEY });

export const PROTOTYPE_WORKFLOW = "prototype-in-app";

export type KnockClientProps = {
  apiKey: string;
  feedId: string;
  userId: string;
  userToken: string;
  signedAt: string;
};

// Runs in the layout loader: the signing key never leaves the server.
export async function getKnockClientProps(user: {
  id: number;
  name: string;
}): Promise<KnockClientProps | null> {
  const apiKey = process.env.KNOCK_PUBLIC_API_KEY;
  const feedId = process.env.KNOCK_FEED_CHANNEL_ID;
  if (!apiKey || !feedId || !process.env.KNOCK_SIGNING_KEY) return null;

  const userId = String(user.id);
  // Identify from the server so the browser never needs write access.
  await knock.users.update(userId, { name: user.name }).catch((e) => {
    console.error("[knock prototype] identify failed", e);
  });

  const userToken = await signUserToken(userId, { expiresInSeconds: 3600 });
  return {
    apiKey,
    feedId,
    userId,
    userToken,
    signedAt: new Date().toISOString(),
  };
}

export const PROTOTYPE_TYPES = [
  "refund-request-decided",
  "refund-request-opened",
  "lesson-question-posted",
  "lesson-reply-posted",
] as const;
export type PrototypeType = (typeof PROTOTYPE_TYPES)[number];

// Sample content per first-ship Notification type (see issue #4).
const SAMPLES: Record<
  PrototypeType,
  { title: string; body: string; url: string; outcome?: string }
> = {
  "refund-request-decided": {
    title: "Refund Request approved",
    body: "Your Refund Request for **Intro to TypeScript** was approved. Note from Cadence: _Sorry it wasn't the right fit._",
    url: "/dashboard",
    outcome: "approved",
  },
  "refund-request-opened": {
    title: "New Refund Request",
    body: "**Amara Okafor** raised a Refund Request for **Intro to TypeScript**: _The pace was too fast for me._",
    url: "/admin/refunds",
  },
  "lesson-question-posted": {
    title: "New Lesson Question",
    body: "**Amara Okafor** asked a Lesson Question on **Generics in practice**: _Why does the constraint need extends here?_",
    url: "/instructor/questions",
  },
  "lesson-reply-posted": {
    title: "New Lesson Reply",
    body: "**Jonas Lindqvist** replied to your Lesson Question on **Generics in practice**.",
    url: "/courses",
  },
};

export async function triggerPrototypeNotification(
  recipientId: number,
  type: PrototypeType
) {
  const sample = SAMPLES[type];
  return knock.workflows.trigger(PROTOTYPE_WORKFLOW, {
    recipients: [String(recipientId)],
    data: { type, ...sample },
  });
}
