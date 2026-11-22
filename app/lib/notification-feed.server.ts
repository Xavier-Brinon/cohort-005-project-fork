import { signUserToken } from "@knocklabs/node";

import type { Person } from "~/lib/notifications.server";

// ─── Notification feed (the bell) ───
// The layout loader calls `notificationFeedProps` to give the sidebar bell
// what Knock's React feed needs. Knock runs with enhanced security, so the
// browser gets a short-lived user token signed here with RS256. The signing
// key and the secret API key stay on the server: only the fields of
// `NotificationFeedProps` reach the browser.

const TOKEN_LIFETIME_SECONDS = 60 * 60;

export interface FeedConfig {
  publicKey: string | undefined;
  feedChannelId: string | undefined;
  signingKey: string | undefined;
}

export interface NotificationFeedProps {
  apiKey: string;
  feedChannelId: string;
  userId: string;
  userToken: string;
}

export function feedConfigFromEnvironment(): FeedConfig {
  return {
    publicKey: process.env.KNOCK_PUBLIC_API_KEY,
    feedChannelId: process.env.KNOCK_FEED_CHANNEL_ID,
    signingKey: process.env.KNOCK_SIGNING_KEY,
  };
}

// Null for a signed-out visitor, who gets no bell and no token, and when
// Knock is not configured.
export async function notificationFeedProps(
  user: Person | null,
  config: FeedConfig = feedConfigFromEnvironment()
): Promise<NotificationFeedProps | null> {
  if (!user) return null;
  const { publicKey, feedChannelId, signingKey } = config;
  if (!publicKey || !feedChannelId || !signingKey) return null;
  const userId = String(user.id);
  const userToken = await signUserToken(userId, {
    signingKey,
    expiresInSeconds: TOKEN_LIFETIME_SECONDS,
  });
  return { apiKey: publicKey, feedChannelId, userId, userToken };
}
