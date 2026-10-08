# Contributor Guidelines

This repo contains a Remix 3 project. This is **NOT** old Remix.

Old Remix (v1/v2) was React-based, and its direct framework continuation became React Router v7. Current Remix 3 is a separate reboot that explicitly does not depend on React. Do not generate React-style Remix code in this repository at all.

Follow this repo’s own primitives, imports, component model, and build/runtime conventions.

## Remix Documentation

This repository contains a comprehensive overview of the Remix API, its runtime behavior, and practical use cases for building interactive UIs and web services, as well as documentation on the various subpath-packages included within the `remix` package.

> Take a look at the files in `./.claude/docs/**/*.md` for detailed documentation on the many functions of the `remix` APIs.

Before changing Pitlane code, read `node_modules/pitlane/INDEX.md`; prefer the installed documentation over memory or the latest website.

## Debugging Approach

- Use `console.log` with clear prefixes during development
- **NEVER** attempt to run the dev server yourself
- If you need to do some debugging, add some `console.log` statements, tell me where I need to look for the `console.log` statements when I run the project myself (client, server, both, somewhere else, etc.), and then I will come back and paste the results of the `console.log` statements for you

## Toolchain

This project uses **Vite+** as its unified toolchain. All commands go through `vp`:

- `vp dev` — start the dev server
- `vp build` — production build to `dist/client` and `dist/ssr`
- `vp preview` — preview the production build
- `vp fmt` — format code with Oxfmt
- `vp lint` — lint code with Oxlint
- `vp check` — run format, lint, and typecheck (via `tsc`) together
- `vp install` / `vp add` / `vp remove` — package management (delegates to pnpm)

Configuration for formatting, linting, and build lives in `vite.config.ts`. There is no separate linter or formatter config file.

## General Rules

- Format and lint code with `vp check --fix` before committing
- Periodically run `vp check` and fix all info, warnings, and errors
- Use JSDoc/TSDoc comments for public APIs
- Document important lines of code with a single line comment
- Prefer `jsr:@std/*` for standard library
    - JSR packages can be installed using `vp add jsr:package-name`
- Use relative imports for local modules
- Prefer Node-native import aliases `#/*` over relative imports for local modules
- Validate environment variables at startup using `remix/assert`
- **Remove anything that isn't used** – delete unused imports, function parameters, and private class members.
- **Use `any` as little as possible** – always prefer `unknown` if the type is unknown.
- **Don't typecast** – avoid typecasting using `as` whenever possible; prefer correct types at the source instead unless they're truly unknown.
- **Infer types as much as possible** – write and utilize APIs to use inferred types instead of needing to explicitly type arguments, variables, functions, etc; most types can be inferred, make sure they absolutely cannot and are not designed to be inferred before explicitly specifying types.
- **Hands off `document.cookie`** – manipulating cookies directly is forbidden. Use Remix's cookie utilities instead.
- **Compile regexes once** – declare regular expressions at module scope, not inside hot functions.
- **Stick to ES modules** – no `require` or other CommonJS patterns.
- **Prefer `import type`** – separate type-only imports.
- **Use the `node:` protocol** – write `import fs from "node:fs"` rather than bare `"fs"`.
- **Arrays = `T[]`** – use shorthand array syntax consistently.
- **Favor `let`** – use `let` over `const` for bindings, unless declaring a truly top-level constant. Then declare it with an all caps binding as a `const`.
- **One `let` per line** – declare variables individually.
- **Skip non-null assertions** – rewrite code so `!` isn't necessary; consider using `remix/data-schema` or `remix/assert` where you might want to use `!`.
- **Avoid `enum`** – choose discriminated unions, objects, or literal types instead.
- **Stick with `trimStart/End`** – don't use `trimLeft/Right`.
- **Default parameters go last** – never precede required params with optional ones.
- **Self-close when empty** – use `<Component />` instead of `<Component></Component>` when there are no children.
- **No unused template literals** – convert to quotes if you're not interpolating.
- **Don't write `substr`** – use `slice` instead.
- **Flatten simple `if` chains** – collapse `else { if … }` when feasible.
- **Keep member access simple** – omit `public`, `private`, or `protected`. Use native JavaScript private properties (e.g. `#property`) when you need to make a property private.
- **Leverage `as const`** – assert immutability where appropriate.
- **Kill useless `else` blocks** – when the `if` branch returns or throws, omit the `else`.
