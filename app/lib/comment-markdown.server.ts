import { marked, Renderer } from "marked";
import { createHighlighter, type Highlighter } from "shiki";

import type { Markdown } from "~/lib/text";

// ─── Comment Rendering ───
// Deliberately separate from renderMarkdown (~/lib/markdown.server).
//
// renderMarkdown handles lesson content and sales copy, which are written by
// instructors — trusted input, raw HTML allowed through. Comments are written by
// students, so the same treatment would be stored XSS against every reader,
// including the instructor and any admin who opens the questions queue.
//
// This renderer never emits author-supplied HTML:
//   - raw HTML blocks/tags are escaped and shown as literal text
//   - link hrefs are restricted to http/https/mailto or a path on this site,
//     and get rel="nofollow"
//   - images are dropped (rendered as their alt text)
//   - everything else goes through marked's own escaping
// Output is still injected with dangerouslySetInnerHTML, so any change here
// needs the same scrutiny.

const SAFE_LINK_PROTOCOLS = ["http:", "https:", "mailto:"];

// A placeholder origin to resolve relative links against. ".invalid" is
// reserved, so no real site can own it.
const RELATIVE_LINK_BASE = "https://relative.invalid";

const COMMENT_LANGS = [
  "typescript",
  "javascript",
  "json",
  "bash",
  "html",
  "css",
  "tsx",
  "jsx",
  "sql",
  "yaml",
  "markdown",
  "text",
  "plaintext",
];

let highlighter: Highlighter | null = null;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighter) {
    highlighter = await createHighlighter({
      themes: ["github-dark"],
      langs: COMMENT_LANGS,
    });
  }
  return highlighter;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Returns the href only when it uses a protocol we allow or is a path on this
 * site. Anything else — javascript:, data:, vbscript:, a link that leaves the
 * site, or an unparseable URL — returns null so the link is downgraded to
 * plain text.
 */
function safeHref(href: string | null): string | null {
  if (!href) return null;

  const trimmed = href.trim();

  try {
    // A link that starts with "/" can still leave the site: browsers read
    // "//host", "/\host" and "/<tab>/host" as another host. Resolve it the
    // way a browser does, and keep it only if it stays on the placeholder
    // origin.
    if (trimmed.startsWith("/")) {
      const relative = new URL(trimmed, RELATIVE_LINK_BASE);
      if (relative.origin !== RELATIVE_LINK_BASE) return null;
      // Resolving removes dot segments, so "/.//host" stays on the origin
      // with the path "//host". Written out, that path names another host.
      if (relative.pathname.startsWith("//")) return null;
      return `${relative.pathname}${relative.search}${relative.hash}`;
    }

    const url = new URL(trimmed);
    return SAFE_LINK_PROTOCOLS.includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export async function renderComment(markdown: Markdown): Promise<string> {
  const hl = await getHighlighter();

  const renderer = new Renderer();

  renderer.code = ({ text, lang }) => {
    const language = lang && COMMENT_LANGS.includes(lang) ? lang : "text";
    try {
      return hl.codeToHtml(text, { lang: language, theme: "github-dark" });
    } catch {
      return `<pre><code>${escapeHtml(text)}</code></pre>`;
    }
  };

  // Raw HTML is shown as text, never emitted as markup.
  renderer.html = ({ text }) => escapeHtml(text);

  renderer.link = function ({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const url = safeHref(href);

    if (!url) return text;

    const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${escapeHtml(url)}"${titleAttr} rel="nofollow noopener noreferrer" target="_blank">${text}</a>`;
  };

  // No images in comments — avoids tracking pixels and layout-breaking uploads.
  renderer.image = ({ text }) => escapeHtml(text);

  return marked.parse(markdown, { renderer, async: false }) as string;
}
