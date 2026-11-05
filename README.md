# ToyHub

ToyHub is an e-commerce platform for selling toys online. It is a server-rendered
Node.js application: Express handles routing and middleware, EJS templates render
every page on the server, MongoDB (through Mongoose) stores the data, and Passport
manages authentication. There is no separate front-end framework or build step -
the browser loads the HTML the server renders, with a small amount of progressive
JavaScript under `public/js`.

## Features

**Admin** - sign in, manage users (list, block/unblock), manage categories, manage
products, and upload product images with cropping and resizing before upload.

**Shopper** - browse the home page and product pages, sign up and sign in (with OTP
and Google sign-in), read and write reviews, add to cart and wishlist, check out
with Razorpay or cash on delivery, use a wallet, and view orders and invoices.

## Quick start

Requirements: Node.js `>= 18.18`, npm `>= 9`, and a reachable MongoDB.

```bash
npm ci                  # clean, reproducible install
cp .env.example .env    # then fill in the values (see docs/configuration.md)
npm run dev             # start the dev server with auto-restart
```

Open http://localhost:3000 once the log prints `Server started on port 3000` and
`MongoDB connected...`. Use `npm start` instead of `npm run dev` for a plain
server with no file watching.

A local MongoDB can be started with Docker:

```bash
docker run -d --name toyhub-mongo -p 27017:27017 mongo:7
# then use MONGO_URI=mongodb://127.0.0.1:27017/toyhub
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the server with `node --watch` for automatic restarts on source changes. |
| `npm start` | Start the server for a long-lived process, after a preflight dependency check. |
| `npm run smoke` | Load every application module and validate the environment without opening a port. |
| `npm test` | Run the `node:test` suite. |
| `npm run lint` | Syntax-check every JavaScript file and enforce the project static rules. |
| `npm run check` | `lint` + `test` + `smoke`, the same three stages CI runs. |

## Testing

`npm test` works from a clean checkout with no configuration: the suite supplies
its own throwaway environment, so no credentials are needed and nothing reads a
real `.env`. Database-backed tests run against a scratch MongoDB and skip
themselves when none is reachable. See [docs/testing.md](docs/testing.md).

## Project structure

```
toyhub
├── server.js        Express app: middleware order and route mounts
├── routes/          One router per area (admin, user, product, cart, checkout, ...)
├── controllers/     adminModules/ and userModules/ page handlers
├── models/          Mongoose schemas
├── utils/           Reusable rules (config, session, csrf, product-form, ...)
├── views/           EJS templates (layouts/, admin/, user/)
├── public/          Static assets (css, js, images, svg)
├── scripts/         Linter, smoke check, probe scripts
└── test/            node:test suites and helpers
```

## Documentation

| Document | Contents |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Request flow, layers and full project layout. |
| [docs/configuration.md](docs/configuration.md) | Environment variables and sessions. |
| [docs/deployment.md](docs/deployment.md) | Deploying, health/readiness probes and the post-deploy checklist. |
| [docs/testing.md](docs/testing.md) | Test layout, CI and `bcrypt` troubleshooting. |
| [docs/dependencies.md](docs/dependencies.md) | Dependency audit and accepted findings. |
| [docs/products.md](docs/products.md) | How adding and editing a product works. |
| [docs/orders.md](docs/orders.md) | Order records, cancellation and legacy data. |
| [docs/probes.md](docs/probes.md) | The manual probe/walkthrough scripts and their scratch database. |

See [SECURITY.md](SECURITY.md) for secret handling and how to report a
vulnerability, and [CONTRIBUTING.md](CONTRIBUTING.md) to contribute.

## License

ISC
