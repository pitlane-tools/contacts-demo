# Contacts Demo

A contacts CRUD app demo, showcasing [Remix](https://remix.run) SSR features. It adapts the [React Router address book tutorial](https://reactrouter.com/tutorials/address-book) to reuse the same patterns in Remix.

## Highlights

- **CRUD server routing** – handlers for listing, creating, updating, and deleting contacts
- [**Frame Navigation primitives**](https://github.com/remix-run/remix/pull/11147) - built-in Remix client-side routing utilizing the [Navigation API](https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API)
- **RESTful forms** – POST/PUT/PATCH/DELETE via hidden-field method override
- **URL-driven search** – filters contacts through query parameters

## Tech Stack

- **Framework:** [`remix`](https://npmx.dev/package/remix/v/3.0.0)
- **Toolchain:** [Vite+](https://viteplus.dev)
- **Formatting:** [Oxfmt](https://oxc.rs/docs/guide/usage/formatter) (via `vp fmt`)
- **Linting:** [Oxlint](https://oxc.rs/docs/guide/usage/linter) (via `vp lint`)
- **Type Checking:** [TypeScript 7 `tsc`](https://npmx.dev/package/typescript/v/rc) (via `vp check`)

## Getting Started

```sh
vp install
vp run dev          # start the dev server on http://localhost:1612
```

## Production

```sh
vp build        # build to dist/client and dist/ssr
vp preview      # review the build on http://localhost:4173
```

## Learn More

- [Remix website](https://remix.run)
- [Remix API docs](https://api.remix.run)
- [Remix UI docs](https://github.com/remix-run/remix/tree/main/packages/ui/docs)
- [Remix packages](https://github.com/remix-run/remix/tree/main/packages)
- [React Router Tutorial](https://reactrouter.com/tutorials/address-book) (original inspiration)
- [Vite+ documentation](https://viteplus.dev)
