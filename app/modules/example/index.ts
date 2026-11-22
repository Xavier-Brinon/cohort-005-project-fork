// Starter template: copy this folder to make a module, or delete it.
// index.ts is an entry point. It delegates to lib/, which outsiders can't reach.
import { slugify } from "./lib/impl";

/** A URL-safe slug for a title, prefixed with its position. */
export function numberedSlug(position: number, title: string) {
  return `${position}-${slugify(title)}`;
}
