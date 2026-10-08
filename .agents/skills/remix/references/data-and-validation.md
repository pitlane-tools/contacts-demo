# Data Access and Validation

## What This Covers

How input becomes a value the app trusts, and how that value reaches storage. Read this when the
task involves:

- Defining database tables, columns, relations, and migrations
- Querying or mutating persisted data with `Database`
- Parsing and validating user input from forms, query strings, or external payloads
- Choosing between schema-level checks, table validation hooks, and migration-level constraints

For where validation runs in the request lifecycle, see `routing-and-controllers.md`. For session
or identity-bound writes, see `auth-and-sessions.md`.

## Table Definitions (`remix/data-table`)

Define tables with typed columns, relations, and optional validation hooks:

```typescript
import type { TableRow, TableRowWith } from "remix/data-table";

import { belongsTo, column as c, hasMany, table } from "remix/data-table";

export const books = table({
    name: "books",
    columns: {
        id: c.integer().primaryKey().autoIncrement(),
        slug: c.text().notNull().unique(),
        title: c.text().notNull(),
        author: c.text().notNull(),
        price: c.decimal(10, 2).notNull(),
        genre: c.text().notNull(),
        in_stock: c.boolean(),
    },
});

export const orders = table({
    name: "orders",
    columns: {
        id: c.integer().primaryKey().autoIncrement(),
        user_id: c.integer().notNull().references("users", "id"),
        total: c.decimal(10, 2).notNull(),
        created_at: c.integer().notNull(),
    },
    relations: {
        user: belongsTo("users", "user_id"),
        items: hasMany("order_items", "order_id"),
    },
});

export type Book = TableRow<typeof books>;
export type Order = TableRow<typeof orders>;
export type OrderWithItems = TableRowWith<typeof orders, "items">;
```

### Column types

| Method                        | SQL type           |
| ----------------------------- | ------------------ |
| `c.integer()`                 | INTEGER            |
| `c.text()`                    | TEXT               |
| `c.boolean()`                 | BOOLEAN            |
| `c.decimal(precision, scale)` | DECIMAL            |
| `c.enum([...])`               | TEXT (string enum) |
| `c.uuid()`                    | UUID / TEXT        |
| `c.varchar(length)`           | VARCHAR            |

Column modifiers: `.primaryKey()`, `.autoIncrement()`, `.notNull()`, `.unique()`,
`.references(table, column, fkName?)`, `.onDelete(action)`, `.default(value)`.

Composite primary keys go on the table option, not the column: `primaryKey: ['order_id', 'book_id']`.

### Schema vs migrations

Column modifiers describe SQL constraints — the source of truth for them is your **migration**
files, where they generate the actual DDL. Runtime `table(...)` definitions in `app/data/schema.ts`
can use the same modifiers, or they can stay minimal (`c.integer()`, `c.text()`, ...) since the
runtime only needs the column shape and validation hooks. Two valid patterns:

- **Modifiers in both** — schema and migrations stay in sync visually; useful when you want
  schema-level docs.
- **Bare columns in schema, full modifiers in migrations** — schema describes what the app reads
  and writes; migrations own the DDL and constraints.

Pick one and apply it consistently across the app.

### Table validation hooks

Tables can define `validate`, `beforeWrite`, and `afterRead` hooks:

```typescript
export const books = table({
    name: "books",
    columns: {/* ... */},
    validate({ operation, value }) {
        let issues = [];
        if (operation === "create" && !value.slug) {
            issues.push({ message: "Slug is required.", path: ["slug"] });
        }
        return issues.length > 0 ? { issues } : { value };
    },
});
```

## Database Setup

Create a database with the concrete factory for your dialect and expose it via middleware. There
are no adapters in `3.0.0-rc.1` — `createDatabase()` and the `*DatabaseAdapter` classes were
removed in favor of `createSqliteDatabase()`, `createPostgresDatabase()`, and
`createMysqlDatabase()`:

```typescript
import { createSqliteDatabase } from "remix/data-table/sqlite";

export let db = createSqliteDatabase({
    filename: "./db/app.db",
    foreignKeys: true,
});
```

The config-backed form uses `node:sqlite` in Node and `bun:sqlite` in Bun, and it supports the
destructive lifecycle methods `db.wipe()` and `db.reset()` because it owns the connection. You can
also pass an existing synchronous client when the application owns its lifecycle, but then the
destructive methods are unavailable:

```typescript
import { Database } from "bun:sqlite";
import { createSqliteDatabase } from "remix/data-table/sqlite";

let sqlite = new Database("app.db");
export let db = createSqliteDatabase(sqlite);
```

Call `await db.close()` during shutdown to release the connection.

### Database middleware

```typescript
import type { Middleware } from "remix/router";

import { Database } from "remix/data-table";

export function loadDatabase(): Middleware {
    return async (context, next) => {
        context.set(Database, db);
        return next();
    };
}
```

### Querying

```typescript
let db = get(Database);

// Find by primary key
let book = await db.find(books, id);

// Find one by condition
let user = await db.findOne(users, { where: { email } });

// Find many with ordering
let allBooks = await db.findMany(books, { orderBy: ["id", "asc"] });

// Count
let total = await db.count(orders, { where: { user_id: userId } });

// Query builder
let genres = await db.query(books).select("genre").distinct().orderBy("genre", "asc").all();

// Create
let newBook = await db.create(books, { slug: "new-book", title: "New Book" /* ... */ });

// Update
await db.update(books, bookId, { title: "Updated Title" });

// Delete
await db.delete(books, bookId);
```

### Operators

```typescript
import { inList } from "remix/data-table/operators";

let featured = await db.findMany(books, {
    where: inList("slug", ["book-a", "book-b", "book-c"]),
});
```

## Migrations

### Writing migrations

TypeScript migrations were removed in `3.0.0-rc.1`. A migration is a directory holding plain SQL:

```
db/migrations/20260228090000_create_users/up.sql      (required)
db/migrations/20260228090000_create_users/down.sql    (optional)
```

`up.sql`:

```sql
create table users (
    id integer primary key autoincrement,
    email text not null unique,
    name text not null
);
create unique index users_email_idx on users (email);
```

`down.sql`:

```sql
drop table users;
```

`column` / `ColumnBuilder` and `table()` still come from `remix/data-table` — they define tables
for **queries**. Only migrations moved to SQL.

By default each migration runs in a transaction where the database supports transactional DDL.
Override it with a directive on the first non-blank line of `up.sql` (`auto`, `required`, `none`):

```sql
-- data-table/transaction: none
create index concurrently users_email_active_idx on users (email) where status = 'active';
```

### Running migrations

Migration running lives on the database instance:

```typescript
import { loadMigrations } from "remix/data-table/migrations/node";

let migrations = await loadMigrations("./db/migrations");
await db.migrate(migrations);
```

`db.migrate()` takes `direction`, mutually exclusive `to`/`step`, `dryRun`, and `journalTable`.
Companion lifecycle methods are `db.migrationStatus()`, `db.reset()`, `db.wipe()`, and
`db.close()`. For non-filesystem runtimes, build the set with `createMigrationRegistry()` from
`remix/data-table/migrations` and pass it to `db.migrate()`.

The CLI drives the same lifecycle: `remix db status`, `remix db migrate`, `remix db rollback`
(`--step`, `--to`, `--dry-run`), `remix db seed`, `remix db reset --force`, `remix db wipe --force`.

### Migration naming

Name each migration directory with a timestamp prefix: `20260228090000_create_users/`. Place them
in `db/migrations/`. Checksums are always `sha256(up)`, so editing an applied migration's `up.sql`
changes its checksum.

## Input Validation (`remix/data-schema`)

Use `data-schema` to validate user input (forms, query params, API payloads). This is separate from
table-level `validate` hooks which run at persistence.

### Schema builders

```typescript
import * as s from "remix/data-schema";
import { email, minLength, maxLength } from "remix/data-schema/checks";

let userSchema = s.object({
    name: s.string().pipe(minLength(1)),
    email: s.string().pipe(email()),
    age: s.optional(s.number()),
});

let result = s.parse(userSchema, data);
```

### FormData validation

Use `remix/data-schema/form-data` to validate `FormData` directly:

```typescript
import * as s from "remix/data-schema";
import { email, minLength } from "remix/data-schema/checks";
import * as f from "remix/data-schema/form-data";

let signupSchema = f.object({
    name: f.field(s.string().pipe(minLength(1))),
    email: f.field(s.string().pipe(email())),
    password: f.field(s.string().pipe(minLength(8))),
});

// In a controller action:
let formData = get(FormData);
let { name, email, password } = s.parse(signupSchema, formData);
```

### Reading FormData: middleware vs `request.formData()`

There are two ways to get a `FormData` value inside an action.

The recommended way: register `formData()` middleware in the root stack and read with
`get(FormData)`. The body is parsed once per request, and the typed `FormData` value flows through
the context system. This also lets `methodOverride()` and CSRF middleware work uniformly.

```typescript
import { formData } from "remix/middleware/form-data";

let router = createRouter({
    middleware: [, /* ... */ formData() /* ... */],
});

// In an action:
let parsed = s.parseSafe(signupSchema, get(FormData));
```

The fallback: `await request.formData()` directly. This works without middleware and is fine for
small one-off cases, but it bypasses the context system, runs once per call site, and doesn't
compose with middleware that depends on parsed form fields.

### Safe parsing

`s.parse` throws on invalid input. `s.parseSafe` returns a tagged result and is usually what an
action wants, since validation failure is an expected outcome (re-render the form with errors)
rather than an exception:

```typescript
let result = s.parseSafe(signupSchema, get(FormData))
if (!result.success) {
  return render(<SignupPage errors={result.issues} />, { status: 400 })
}
let { name, email, password } = result.value
```

Returning a `Response` for validation failures keeps the route contract honest: the same action
returns 200 on success, 400 with errors on bad input, no out-of-band exception flow.

### Transforming validated output

Use `.transform(...)` when a schema should validate one shape but return another value or output
type. Transforms run after validation and compose with `.pipe(...)` and `.refine(...)`:

```typescript
import * as coerce from "remix/data-schema/coerce";

let slugSchema = s
    .string()
    .pipe(minLength(1))
    .transform(value => value.trim().toLowerCase().replace(/\s+/g, "-"));

let pageSchema = f.object({
    page: f.field(s.defaulted(coerce.coerceNumber(), 1).refine(Number.isInteger)),
    q: f.field(s.defaulted(s.string(), "").transform(value => value.trim())),
});

let { page, q } = s.parse(pageSchema, formData);
```

### Anti-patterns

Avoid these shapes when reading and validating input:

- **Raw `formData.get('name')` plus an `if (typeof name !== 'string')` guard**, then a thrown
  custom error. This reinvents what `data-schema` already does, loses the typed result, and
  pushes error translation into a `try/catch` instead of a return value.
- **Letting route-local domain errors leak out of the action.** Translate expected outcomes (bad
  input, missing record, duplicate entry) into the `Response` the route means to return instead of
  throwing a custom `Error` subclass with a `status` field and catching it later.
- **Trusting `params`, query strings, or external payloads without a schema.** Anything that
  crosses a trust boundary should be parsed before it reaches business logic.

### Common patterns

```typescript
// Optional with default
let limitSchema = f.field(s.defaulted(s.string(), "10"));

// Union types
let methodSchema = s.union([s.literal("credentials"), s.literal("google"), s.literal("github")]);

// Refinements
let idSchema = s.number().refine(Number.isInteger, "Expected an integer");
```
