// @ts-check
// Deep-module enforcement for dependency-cruiser.
//
// Each package under the packages root is a DEEP MODULE: a lot of behaviour
// behind a small interface. A package's PUBLIC SURFACE is its ENTRY POINTS:
// the files at the package root. Implementation lives in SUBFOLDERS and is
// private (by convention `lib/` for implementation and `tests/` for tests,
// though any subfolder is private). A package may expose several small entry
// points (index.ts, client.ts, server.ts, …); prefer that over one giant
// barrel index.
//
// The only thing you should ever need to edit here is PACKAGES_ROOT.

/** Where packages live. One immediate child dir per package (flat, no nesting). */
const PACKAGES_ROOT = "app/modules";

// --- derived patterns (no need to edit) -------------------------------------
const R = PACKAGES_ROOT;
/**
 * A package's private internals: anything nested inside a package subfolder.
 * The package's root files are its entry points and are NOT matched here:
 * they stay importable from outside.
 */
const PACKAGE_INTERNALS = `^${R}/[^/]+/[^/]+/`;

// --- project rules (CODING_STANDARDS.md) ------------------------------------
/**
 * The database connection and its query builder. The schema is not on the
 * list: enumerations live there, and any file may compare against them.
 */
const DATA_LAYER = "^app/db/index\\.ts$|node_modules/drizzle-orm/";
/** Everything a test needs to insert rows directly: tables included. */
const ROW_WRITES = "^app/db/|node_modules/drizzle-orm/";
/** Code that can end up in the browser bundle (routes are split by the framework). */
const CLIENT_CODE = "^app/(components|lib|modules)/|^app/root\\.tsx$";
/** Files that never reach the browser. */
const SERVER_OR_TEST = "\\.server\\.[jt]sx?$|\\.test\\.[jt]sx?$|/tests/";
/** What must never reach the browser. */
const SERVER_ONLY = `\\.server\\.[jt]sx?$|${DATA_LAYER}|node_modules/(better-sqlite3|@knocklabs/node)/`;

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "entrypoint-boundary-from-app",
      comment:
        "App/root code may import a package's entry points (its root files), but nothing inside its subfolders.",
      severity: "error",
      from: { pathNot: `^${R}/` }, // importer is NOT inside any package
      to: { path: PACKAGE_INTERNALS },
    },
    {
      name: "entrypoint-boundary-across-packages",
      comment:
        "A package's own files import each other freely, but may reach OTHER packages only through their entry points, never their internals.",
      severity: "error",
      // importer is inside a package ($1), but is not a test file
      from: { path: `^${R}/([^/]+)/`, pathNot: `^${R}/[^/]+/tests/` },
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/`, // same package → intra-package freedom
      },
    },
    {
      name: "tests-through-entrypoints",
      comment:
        "A package's tests exercise it through its entry points like everyone else: they may import any package's entry points and their own tests/ fixtures, but never any package's internals, not even their own.",
      severity: "error",
      from: { path: `^${R}/([^/]+)/tests/` }, // a test file, in package $1
      to: {
        path: PACKAGE_INTERNALS,
        pathNot: `^${R}/$1/tests/`, // own tests/ fixtures → allowed
      },
    },
    {
      name: "tests-folder-is-private",
      comment:
        "A package's tests/ folder is reachable only from tests: nothing else may import fixtures.",
      severity: "error",
      from: { pathNot: `^${R}/[^/]+/tests/` }, // importer is not itself a test
      to: { path: `^${R}/[^/]+/tests/` },
    },
    {
      name: "no-circular",
      comment:
        "No dependency cycles. Scope to `^${R}/` if you want to allow cycles outside packages.",
      severity: "error",
      from: {},
      to: { circular: true },
    },

    // --- Data ownership (CODING_STANDARDS.md) ---------------------------------
    // Existing violations live in .dependency-cruiser-known-violations.json,
    // which `npm run lint:boundaries` ignores. Move a route's data behind a
    // module, then run `npm run lint:boundaries:baseline` to shrink the file.
    {
      name: "routes-ask-modules-for-data",
      comment:
        "A route does not query data a module owns: it asks the module, and does not import ~/db or drizzle-orm itself.",
      severity: "error",
      from: { path: "^app/routes/" },
      to: { path: DATA_LAYER },
    },
    {
      name: "module-tests-arrange-through-module",
      comment:
        "Test setup calls the module's own functions. When the function you need does not exist, add it to the module rather than inserting rows through ~/db or drizzle-orm.",
      severity: "error",
      from: { path: `^${R}/[^/]+/tests/` },
      to: { path: ROW_WRITES },
    },

    // --- Secrets stay on the server -------------------------------------------
    {
      name: "client-code-imports-no-server-code",
      comment:
        "Code that can reach the browser bundle may not import .server files, the database, or server-only SDKs. Anything the browser can read is public.",
      severity: "error",
      from: { path: CLIENT_CODE, pathNot: SERVER_OR_TEST },
      to: { path: SERVER_ONLY },
    },
    {
      name: "client-code-imports-no-node-builtins",
      comment:
        "Code that can reach the browser bundle may not import Node built-ins (fs, process, crypto, ...).",
      severity: "error",
      from: { path: CLIENT_CODE, pathNot: SERVER_OR_TEST },
      to: { dependencyTypes: ["core"] },
    },

    // --- Layering (optional, off by default) ----------------------------------
    // Interface-hiding controls HOW you import (through the entry points).
    // Layering controls WHICH packages may depend on which. Add your own rules
    // here, e.g.:
    //
    // {
    //   name: "ui-may-not-depend-on-billing",
    //   severity: "error",
    //   from: { path: `^${R}/ui/` },
    //   to:   { path: `^${R}/billing/` },
    // },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    preserveSymlinks: true,
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
