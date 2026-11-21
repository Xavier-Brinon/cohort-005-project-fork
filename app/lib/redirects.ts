// Any origin works as the base, as long as no real redirect target can have
// it: a target that parses to another origin points off this site.
const THIS_SITE = "http://this-site.invalid";

/**
 * `target` if it is a path on this site, otherwise `fallback`.
 *
 * Checking `startsWith("/")` is not enough: browsers read `//evil.com` and
 * `/\\evil.com` as links to another site. The target is parsed the way a
 * browser would and returned in its normalised form, so the redirect goes
 * where the check looked.
 */
export function safeRedirectPath(target: string | null, fallback: string) {
  if (!target?.startsWith("/")) return fallback;

  try {
    const url = new URL(target, THIS_SITE);
    if (url.origin !== THIS_SITE) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
