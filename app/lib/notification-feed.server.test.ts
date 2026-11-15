import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  notificationFeedProps,
  type FeedConfig,
} from "./notification-feed.server";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const signingKey = privateKey
  .export({ type: "pkcs8", format: "pem" })
  .toString();

const config: FeedConfig = {
  publicKey: "pk_test_public",
  feedChannelId: "feed-channel-id",
  signingKey,
};

describe("notificationFeedProps", () => {
  it("signs no token for a signed-out visitor", async () => {
    expect(await notificationFeedProps(null, config)).toBeNull();
  });

  it.each(["publicKey", "feedChannelId", "signingKey"] as const)(
    "signs no token when %s is not set",
    async (missing) => {
      const props = await notificationFeedProps(
        { id: 3, name: "Pat Admin" },
        { ...config, [missing]: undefined }
      );
      expect(props).toBeNull();
    }
  );

  it("hands the browser only the public key, channel, user id and token", async () => {
    const props = await notificationFeedProps(
      { id: 3, name: "Pat Admin" },
      config
    );
    if (!props) throw new Error("Expected feed props");

    expect(Object.keys(props).sort()).toEqual([
      "apiKey",
      "feedChannelId",
      "userId",
      "userToken",
    ]);
    expect(JSON.stringify(props)).not.toContain("PRIVATE KEY");
  });

  it("signs an RS256 user token for a signed-in person", async () => {
    const props = await notificationFeedProps(
      { id: 3, name: "Pat Admin" },
      config
    );

    if (!props) throw new Error("Expected feed props");

    expect(props).toMatchObject({
      apiKey: "pk_test_public",
      feedChannelId: "feed-channel-id",
      userId: "3",
    });
    const [header, payload, signature] = props.userToken.split(".");
    expect(decode(header)).toMatchObject({ alg: "RS256" });
    expect(decode(payload)).toMatchObject({ sub: "3" });
    const signed = verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      publicKey,
      Buffer.from(signature, "base64url")
    );
    expect(signed).toBe(true);
  });
});

function decode(segment: string): unknown {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}
