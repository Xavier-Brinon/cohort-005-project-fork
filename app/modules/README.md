# Modules

Each folder here is a **deep module**: a lot of behaviour behind a small interface. Its public surface is its **entry points**, the files at the module root. Everything in a subfolder is private.

```
app/modules/
  <name>/
    index.server.ts   ← an entry point (public). Import this from outside.
    other.server.ts   ← another entry point. Modules may expose several.
    lib/              ← implementation: hidden from outside, free to import each other.
    tests/            ← tests and fixtures (a subfolder, so private).
```

Copy `example/` to start a new module. `instructor-analytics/` is a real one: `index.server.ts` serves the route with the live database and clock, `analytics.server.ts` is the seam tests use to inject an in-memory database and a fixed day.

**No barrel files.** Don't re-export a whole subtree through one `index.ts`. Expose several small entry points, each exporting only what its callers need.

## The rules

Run `npm run lint:boundaries` (dependency-cruiser, config in `.dependency-cruiser.cjs`). All rules are errors.

1. **Entry-point boundary.** Code outside a module (routes, components, `app/lib`, or another module) imports only that module's root files, never anything in its subfolders.
2. **Intra-module freedom.** A module's own files import each other freely.
3. **Tests through the entry points.** Files under `<module>/tests/` may import any module's entry points and their own `tests/` fixtures, but no module's subfolder internals, not even their own.
4. **No cycles.** No dependency cycles anywhere in `app/`.

Modules are flat: one level of folders under `app/modules/`. Any subfolder of a module is private, so adding a folder needs no config change. Which modules may depend on which (layering) is not enforced yet; add rules in `.dependency-cruiser.cjs` when needed.
