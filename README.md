# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
pnpm dlx sv@0.16.1 create --template minimal --types ts --add eslint prettier vitest="usages:unit,component" playwright --no-download-check --install pnpm .
```

## Developing

Once you've created a project and installed dependencies with `pnpm install`, start a development server:

```sh
pnpm dev

# or start the server and open the app in a new browser tab
pnpm dev -- --open
```

## Building

To create a production version of your app:

```sh
pnpm build
```

You can preview the production build with `pnpm preview`.

## Deploying

Apply D1 migrations before deploying either Worker:

```sh
pnpm exec wrangler d1 migrations apply DB --remote
```

Provision the same server-only NWC connection separately for both Workers. Each command
prompts for the value interactively; never pass the connection string on the command line or
commit it to the repository:

```sh
pnpm exec wrangler secret put NWC_CONNECTION_STRING
pnpm exec wrangler secret put NWC_CONNECTION_STRING --config wrangler.reconciler.jsonc
```

Build and deploy the SvelteKit Worker and the deposit reconciler:

```sh
pnpm build
pnpm exec wrangler deploy
pnpm exec wrangler deploy --config wrangler.reconciler.jsonc
```

The reconciler runs every minute and uses the same D1 database as the application. Test its
scheduled handler locally with Wrangler's `/cdn-cgi/handler/scheduled` endpoint.
