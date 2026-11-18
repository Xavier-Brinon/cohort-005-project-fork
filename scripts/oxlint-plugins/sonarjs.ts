// oxlint JS plugin: sonarjs/no-commented-code, with a parser.
//
// The rule decides whether a comment is code by parsing it with
// `context.languageOptions.parser`. ESLint provides that parser; oxlint does
// not, and without it the rule silently reports nothing. This wrapper hands
// the rule typescript-estree, the parser it had under ESLint.
import { parse } from "@typescript-eslint/typescript-estree";
import sonarjs from "eslint-plugin-sonarjs";

/** The part of an ESLint rule this wrapper forwards to. */
interface ForwardedRule {
  meta?: unknown;
  create(context: object): unknown;
}

const noCommentedCode = sonarjs.rules?.["no-commented-code"] as
  | ForwardedRule
  | undefined;
if (!noCommentedCode) {
  throw new Error("eslint-plugin-sonarjs no longer has no-commented-code");
}
const { meta, create } = noCommentedCode;
const parser = { parse };

/**
 * The rule's context, with the parser the rule expects added to its language
 * options. Everything else passes through untouched: oxlint freezes the
 * context's methods, and a proxy must return a frozen property as it is.
 */
function withParser(context: object) {
  return new Proxy(context, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (property !== "languageOptions") return value;
      return { ...(value as object), parser };
    },
  });
}

export default {
  meta: { name: "sonarjs" },
  rules: {
    "no-commented-code": {
      meta,
      create: (context: object) => create(withParser(context)),
    },
  },
};
