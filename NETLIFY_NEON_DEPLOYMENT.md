# Netlify and Neon deployment

The application is configured for PostgreSQL through Prisma's Neon serverless driver adapter. Netlify should use the Neon pooled connection for runtime traffic and the Neon direct connection for Prisma schema changes.

## Configure environment variables

In the Netlify site settings, configure these variables for the deploy contexts that will run the app:

- `DATABASE_URL`: Neon pooled connection string, including `sslmode=require`.
- `DATABASE_URL_UNPOOLED`: Neon direct connection string, including `sslmode=require`.
- `AUTH_SECRET`: a unique, random secret with at least 32 bytes of entropy.

The local `.env.example` shows the expected connection-string format. Do not commit credentials or use the existing MySQL connection string.

## Initialize the Neon schema

The current project uses `prisma db push` and does not have a Prisma migration history. The supplied MySQL export was first validated on an isolated Neon branch, then imported into production after confirming the production branch was empty. The import contained 608 rows across 18 tables; the importer verified the row counts and database relations. The source MySQL database was not changed.

The importer is [scripts/migrate-mysql-dump-to-neon.mjs](./scripts/migrate-mysql-dump-to-neon.mjs). Production imports require an explicit `--confirm-production-import` flag and are refused if any target table already contains records.

For future schema changes, verify the target branch and have a backup/rollback plan before applying schema changes:

```bash
pnpm install --frozen-lockfile
pnpm run db:generate
pnpm run db:push
```

Do not run `db:push` as part of a Netlify build or against the existing MySQL database. The Neon production database now contains the imported snapshot; the MySQL source remains unchanged.

The Prisma schema already uses unique indexes for Work Order numbers, MRS numbers, and item codes. It also defines indexes for Work Order status/date, MRS status/date and Work Order links, stock by warehouse/item, and Stock Movement item/warehouse/type/date queries. Prisma's `warehouse` field is an enum, not a `warehouseId`. Apply any new or changed schema indexes to a reviewed Neon branch first; only push them to production after confirming the generated schema diff and planning the deployment.

## Deploy on Netlify

Connect the repository to Netlify and use the standard Next.js build command:

```text
Build command: pnpm run build
Publish directory: .next
```

Netlify's Next.js runtime adapter handles the Next.js routes and server actions. Ensure the site uses a supported Node.js version for the project's Next.js and Prisma versions. Set the environment variables before the first production deploy.

## Database connection guidance

- Use the pooled Neon URL for `DATABASE_URL` to avoid exhausting PostgreSQL connections from serverless functions.
- Use the unpooled Neon URL for `DATABASE_URL_UNPOOLED` when running Prisma schema commands.
- Keep credentials in Netlify environment settings and local ignored `.env` files only.
- Confirm authentication, reports (including low-stock), inventory, receiving attachments, and server actions against the Neon database before production use.
- Configure and verify a backup and restore process for the Neon database before importing any production data.
