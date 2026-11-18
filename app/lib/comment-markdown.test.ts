import type { Highlighter } from "shiki";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as CommentMarkdown from "./comment-markdown.server";
import { markdown } from "./text";

// Wrap shiki's createHighlighter so the tests can see every highlighter the
// renderer creates, and make one of them fail on demand.
const highlighters = vi.hoisted(() => [] as Highlighter[]);

vi.mock("shiki", async (importOriginal) => {
  const actual = await importOriginal<typeof import("shiki")>();
  return {
    ...actual,
    createHighlighter: async (
      ...options: Parameters<typeof actual.createHighlighter>
    ) => {
      const highlighter = await actual.createHighlighter(...options);
      highlighters.push(highlighter);
      return highlighter;
    },
  };
});

/** The distinct token colours in shiki output: plain text has one, highlighted code several. */
function tokenColors(html: string): Set<string> {
  return new Set(
    [...html.matchAll(/<span style="color:(#[0-9a-f]+)/gi)].map(([, color]) =>
      color.toLowerCase()
    )
  );
}

let renderComment: typeof CommentMarkdown.renderComment;

beforeEach(async () => {
  // The renderer caches its highlighter in module state, so with one shared
  // copy only the first test to render would ever create it. Stryker runs
  // only the tests that cover a mutant, so a mutant that breaks highlighter
  // creation would face that one test alone, whichever it is. A fresh copy
  // per test makes every test create its own highlighter.
  vi.resetModules();
  highlighters.length = 0;
  ({ renderComment } = await import("./comment-markdown.server"));
});

describe("renderComment", () => {
  describe("markdown", () => {
    it("renders basic formatting", async () => {
      const html = await renderComment(markdown("**bold** and _italic_"));

      expect(html).toContain("<strong>bold</strong>");
      expect(html).toContain("<em>italic</em>");
    });

    it("renders lists", async () => {
      const html = await renderComment(markdown("- one\n- two"));

      expect(html).toContain("<li>one</li>");
    });

    it("highlights fenced code with shiki", async () => {
      const html = await renderComment(
        markdown("```typescript\nconst a = 1;\n```")
      );

      expect(html).toContain("shiki");
      expect(html).toContain("const");
    });

    it.each([
      ["typescript", "const a: number = 1;"],
      ["javascript", "const a = 1;"],
      ["json", '{"a": 1}'],
      ["bash", 'echo "hi"'],
      ["html", '<p class="x">hi</p>'],
      ["css", "a { color: red; }"],
      ["tsx", "const a = <div />;"],
      ["jsx", "const a = <div />;"],
      ["sql", "SELECT 1 FROM t;"],
      ["yaml", "a: 1"],
      ["markdown", "# Title\n\n**bold**"],
    ])("highlights %s", async (lang, code) => {
      const html = await renderComment(
        markdown(`\`\`\`${lang}\n${code}\n\`\`\``)
      );

      expect(tokenColors(html).size).toBeGreaterThan(1);
    });

    it("renders unknown languages as plain text through shiki", async () => {
      const html = await renderComment(markdown("```brainfuck\n+++\n```"));

      expect(html).toContain('class="shiki');
      expect(html).toContain("+++");
      expect(tokenColors(html).size).toBeLessThanOrEqual(1);
    });

    it("creates the highlighter once and reuses it", async () => {
      await renderComment(markdown("```json\n{}\n```"));
      await renderComment(markdown("```json\n{}\n```"));

      expect(highlighters).toHaveLength(1);
    });

    it("falls back to an escaped block when shiki throws", async () => {
      await renderComment(markdown("warm up"));
      const [highlighter] = highlighters;
      if (!highlighter) throw new Error("renderComment created no highlighter");
      vi.spyOn(highlighter, "codeToHtml").mockImplementationOnce(() => {
        throw new Error("shiki failed");
      });

      const html = await renderComment(markdown('```text\n<b> & "x"\n```'));

      expect(html).toContain(
        "<pre><code>&lt;b&gt; &amp; &quot;x&quot;</code></pre>"
      );
    });

    it("escapes markup inside code blocks", async () => {
      const html = await renderComment(
        markdown("```html\n<script>alert(1)</script>\n```")
      );

      // shiki escapes as &#x3C; rather than &lt; — either is safe.
      expect(html).not.toContain("<script>");
      expect(html).not.toContain("</script>");
    });

    it("escapes markup inside inline code", async () => {
      const html = await renderComment(markdown("use `<script>` carefully"));

      expect(html).not.toContain("<script>");
    });
  });

  describe("raw HTML", () => {
    it("escapes a script tag instead of emitting it", async () => {
      const html = await renderComment(
        markdown("<script>alert('xss')</script>")
      );

      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });

    it("escapes an event-handler attribute", async () => {
      const html = await renderComment(
        markdown('<img src=x onerror="alert(1)">')
      );

      expect(html).not.toContain("<img");
      expect(html).not.toContain('onerror="alert(1)"');
    });

    it("escapes an iframe", async () => {
      const html = await renderComment(
        markdown('<iframe src="https://evil.test">')
      );

      expect(html).not.toContain("<iframe");
    });

    it("escapes inline HTML mixed into a paragraph", async () => {
      const html = await renderComment(
        markdown("hello <b onclick='x()'>there</b>")
      );

      expect(html).not.toContain("<b onclick");
      expect(html).toContain("&lt;b onclick");
    });

    it("escapes every markup character in a tag", async () => {
      const html = await renderComment(
        markdown(`hi <a href="?a=1&b=2" title='t'>`)
      );

      expect(html).toContain(
        "&lt;a href=&quot;?a=1&amp;b=2&quot; title=&#39;t&#39;&gt;"
      );
    });

    it("escapes a style tag", async () => {
      const html = await renderComment(
        markdown("<style>body{display:none}</style>")
      );

      expect(html).not.toContain("<style>");
    });
  });

  describe("links", () => {
    it("keeps http and https links and marks them nofollow", async () => {
      const html = await renderComment(
        markdown("[docs](https://example.test/a)")
      );

      expect(html).toContain(
        '<a href="https://example.test/a" rel="nofollow noopener noreferrer" target="_blank">docs</a>'
      );
    });

    it("keeps http links", async () => {
      const html = await renderComment(
        markdown("[docs](http://example.test/a)")
      );

      expect(html).toContain('href="http://example.test/a"');
    });

    it("keeps mailto links", async () => {
      const html = await renderComment(
        markdown("[mail](mailto:a@example.test)")
      );

      expect(html).toContain('href="mailto:a@example.test"');
    });

    it("keeps relative links", async () => {
      const html = await renderComment(
        markdown("[lesson](/courses/x/lessons/1)")
      );

      expect(html).toContain('href="/courses/x/lessons/1"');
    });

    it("keeps a relative link written with spaces around it", async () => {
      const html = await renderComment(
        markdown("[lesson](< /courses/x/lessons/1 >)")
      );

      expect(html).toContain('href="/courses/x/lessons/1"');
    });

    it("keeps the query and fragment of a relative link", async () => {
      const html = await renderComment(
        markdown("[lesson](/courses/x?tab=notes#c2)")
      );

      expect(html).toContain('href="/courses/x?tab=notes#c2"');
    });

    it.each([
      ["a backslash", "[click](/\\evil.test)"],
      ["a tab", "[click](</\t/evil.test>)"],
      ["a dot segment", "[click](/.//evil.test)"],
      ["a parent segment", "[click](/..//evil.test)"],
      ["a parent segment after a path", "[click](/a/..//evil.test)"],
    ])(
      "downgrades a relative link that a browser reads as off-site through %s",
      async (_, source) => {
        const html = await renderComment(markdown(source));

        expect(html).not.toContain("<a ");
        expect(html).toContain("click");
      }
    );

    it("escapes a link title", async () => {
      const html = await renderComment(
        markdown('[x](https://example.test "a \\"b\\" <c>")')
      );

      expect(html).toContain('title="a &quot;b&quot; &lt;c&gt;"');
    });

    it("downgrades a javascript: link to plain text", async () => {
      const html = await renderComment(
        markdown("[click](javascript:alert(1))")
      );

      expect(html).not.toContain("javascript:");
      expect(html).not.toContain("<a ");
      expect(html).toContain("click");
    });

    it("downgrades a data: link to plain text", async () => {
      const html = await renderComment(
        markdown("[click](data:text/html;base64,PHNjcmlwdD4=)")
      );

      expect(html).not.toContain("<a ");
    });

    it("downgrades a URL that does not parse", async () => {
      const html = await renderComment(markdown("[click](http://[bad)"));

      expect(html).not.toContain("<a ");
      expect(html).toContain("click");
    });

    it("downgrades a protocol-relative link", async () => {
      const html = await renderComment(markdown("[click](//evil.test)"));

      expect(html).not.toContain("<a ");
    });

    it("escapes quotes in a link title", async () => {
      const html = await renderComment(
        markdown('[x](https://example.test "a" onmouseover="alert(1)")')
      );

      expect(html).not.toContain('onmouseover="alert(1)"');
    });

    it("keeps autolinks", async () => {
      const html = await renderComment(markdown("<https://example.test>"));

      expect(html).toContain('href="https://example.test/"');
    });
  });

  describe("images", () => {
    it("drops images, keeping only the alt text", async () => {
      const html = await renderComment(
        markdown("![tracking](https://evil.test/px.gif)")
      );

      expect(html).not.toContain("<img");
      expect(html).toContain("tracking");
    });
  });
});
