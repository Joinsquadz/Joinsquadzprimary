---
name: node --import needs ./ on relative paths
description: Why a workspace-relative path in `node --import` throws ERR_MODULE_NOT_FOUND "Cannot find package 'artifacts'", and why the deployment log misattributes it to the wrong artifact.
---

# `--import` resolves as an ESM specifier, not a path

A relative path passed to `node --import` MUST start with `./` (or be a `file://`
URL). Without the prefix, Node treats it as a **bare package specifier** and tries
to resolve the first path segment as a package name.

So `node --import artifacts/api-server/dist/instrument.mjs` fails with:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'artifacts' imported from /home/runner/workspace/
```

The word in quotes is the first path segment — it is NOT a missing dependency.
Chasing it as a dependency problem (checking node_modules, the lockfile,
externals in build.mjs) is a dead end.

**Why:** the trailing *entry-point* argument (`node ... dist/index.mjs`) uses CLI
path resolution and works fine unprefixed. `--import` / `--require` do not. This
asymmetry is why adding a Sentry ESM preload to an otherwise-working run command
breaks it while the command "looks" correct.

**How to apply:** any time a run command in an `artifact.toml`
`[services.production.run]` (or a package script) gains a `--import` / `--require`
preload, prefix the path with `./`. Verify with the literal production argv from
the repo root before deploying:

```
node --import ./path/to/instrument.mjs -e "console.log('BOOT OK')"
```

# Deployment logs do not attribute stderr to an artifact

In monorepo (multi-artifact) deployments, artifact stderr lines are emitted as
bare `[ts ERROR] <line>` with **no artifact tag**. They interleave by timestamp,
so a crash appears under whichever `starting artifact process args=[...]` line
happens to precede it — which is often the wrong artifact.

Two reliable disambiguators:

- `ERR_MODULE_NOT_FOUND` is **ESM-only**. An artifact whose entry is CommonJS
  (`require(...)`) physically cannot emit it.
- An artifact reported as `Command failed with signal "SIGTERM"` /
  `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` was **killed during teardown**, not the
  original crasher. The real crasher is the one whose port is missing from
  `not all artifact ports opened within timeout expected=[...] detected=N`.

**Why:** one artifact failing to open its port tears down every sibling, so the
healthy artifacts produce the loudest, last, and most artifact-labeled failures.

# Platform log capture drops the tail of a fast crash

For a process that dies within ~600ms of start, the deployment log kept only the
first 3 stderr lines (the `package_json_reader:316` frame, the `throw` line, and
the `^` caret) and dropped the blank line, the `Error [...]: Cannot find package`
message, and the whole stack. There is no verbosity knob for this.

**How to apply:** do not keep re-deploying to try to see more. Reproduce the
crash locally using the exact argv from `[services.production.run]` — the full
error and stack come back immediately, for free, with no deploy cycle.
