# ToyHub

ToyHub is an e-commerce platform for selling toys online. It is a server-rendered Node.js application: Express handles routing and middleware, EJS templates render every page on the server, MongoDB (through Mongoose) stores the data, and Passport manages authentication. There is no separate front-end framework or build step - the browser loads the HTML the server renders, with a small amount of progressive JavaScript under `public/js`.

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Running locally](#running-locally)
- [Testing](#testing)
- [Dependency audit](#dependency-audit)
- [Environment configuration](#environment-configuration)
- [Sessions](#sessions)
- [Deployment](#deployment)
- [Adding a product](#adding-a-product)
- [Order records](#order-records)
- [Cancelling an order](#cancelling-an-order)

## Features

### Admin Side
- Admin sign in
- User management (list, block/unblock users)
- Category management (add, edit, delete categories)
- Product management (add, edit, delete products)
- Multiple product images with cropping and resizing before upload

### User Side
- Home page with product listings
- User sign up & login with validation
- Sign up with OTP verification and timer
- Social login (Google, Facebook, etc.)
- Product details view with image zoom
- Product detailed page includes:
  - Breadcrumbs
  - Ratings
  - Price
  - Discounts or coupons applied
  - Reviews
  - Stock status
  - Product highlights/specifications
  - Related product recommendations

## Architecture

ToyHub is a classic server-rendered MVC application. A request passes through one
`server.js` middleware stack and ends at an EJS template:

```
browser -> Express (server.js)
        -> session -> security headers -> Passport -> body parsers -> static files
        -> view locals -> EJS layout -> CSRF -> router
        -> controller -> Mongoose model -> MongoDB
        -> EJS view (views/**) -> HTML
```

- **Routing.** `routes/` holds one router per area, mounted in `server.js`:
  `/` (home), `/admin`, `/user`, `/auth` (Google sign-in), `/product`,
  `/account`, `/cart` and `/checkout`.
- **Controllers.** `controllers/adminController.js` and
  `controllers/userController.js` are thin entry points; the work lives in
  `controllers/adminModules/` and `controllers/userModules/`, grouped by page.
- **Models.** `models/*.models.js` are Mongoose schemas. Business rules that
  would otherwise be copied between pages live in `utils/` alongside them
  (`product-form.js`, `coupon-rules.js`, `order-transitions.js`, `wallet.js`,
  and so on).
- **Views.** EJS templates under `views/` share `views/layouts/layout.ejs`;
  `views/admin/` and `views/user/` hold the page bodies, and `views/403.ejs`
  and `views/404.ejs` are the error pages.
- **Cross-cutting.** `utils/config.js` validates the environment at startup and
  refuses to boot on a missing or unsafe value; `utils/session.js` builds the
  Mongo-backed session; `utils/csrf.js` publishes and enforces a per-session
  token; `middlewares/` holds the authentication and role checks.
- **Background helpers.** `scripts/` contains the linter, the startup smoke
  check and the page-probe scripts used to exercise signed-in flows by hand.

## Project structure

```
toyhub
├── server.js              Express app: middleware order and route mounts
├── routes/                One router per area (admin, user, product, cart, checkout, ...)
├── controllers/
│   ├── adminController.js, userController.js   Thin entry points
│   ├── adminModules/      Admin handlers (products, categories, coupons, offers, orders, ...)
│   └── userModules/       Shopper handlers (landing, auth, cart, checkout, profile, ...)
├── middlewares/           Authentication and role checks (userMiddleware, adminMiddleware)
├── models/                Mongoose schemas (users, products, orders, cart, wallet, ...)
├── utils/                 Reusable rules (config, session, csrf, product-form, order-transitions, ...)
├── views/
│   ├── layouts/layout.ejs Shared layout every page renders into
│   ├── admin/             Admin pages
│   ├── user/              Shopper pages
│   ├── 403.ejs, 404.ejs   Error pages
├── public/                Static assets (css, js, images, svg)
├── scripts/               Linter, startup smoke check, page-probe scripts
├── test/                  node:test suites (test/*.test.js) and reusable helpers
├── .env.example           Every supported environment variable, with empty values
└── .github/workflows/     Continuous integration (lint, test, startup checks)
```

## Running locally

### Requirements

- Node.js `>= 18.18` (`.nvmrc` pins `22`, the version used for the clean-install check) and npm `>= 9`
- A reachable MongoDB instance (local `mongod`, Docker, or MongoDB Atlas)

### Steps

```bash
nvm use                 # optional, switches to the pinned Node version
npm ci                  # clean, reproducible install
cp .env.example .env    # then fill in the values, see below
npm run smoke           # optional: verify install + env without opening a port
npm start
```

`npm start` runs a preflight check first, so a broken native dependency is reported with fix instructions instead of a `MODULE_NOT_FOUND` stack trace. Open http://localhost:3000 once the log prints `Server started on port 3000` and `MongoDB connected...`.

A local MongoDB can be started with Docker:

```bash
docker run -d --name toyhub-mongo -p 27017:27017 mongo:7
# then use MONGO_URI=mongodb://127.0.0.1:27017/toyhub
```

### Scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Preflight dependency check, then start the server. |
| `npm run smoke` | Load every application module and validate the environment without opening a port. |
| `npm test` | Run the `node:test` suite. |
| `npm run lint` | Syntax-check every tracked JavaScript file and enforce the project static rules. |
| `npm run check` | `lint` + `test` + `smoke`, the same three stages CI runs. |

## Testing

`npm test` works from a clean checkout with no configuration: the suite supplies its own throwaway environment, so no production credentials are needed and nothing reads a real `.env`.

- Tests live in `test/*.test.js` and run on the built-in `node:test` runner.
- `test/helpers/test-env.js` builds the test environment and refuses any MongoDB URI whose database name does not contain `test`, so a test run can never write to production data.
- `test/helpers/test-db.js` connects, clears and disconnects the test database, and skips database-backed tests with an explanatory message when no MongoDB is reachable. Because `node --test` runs test files in parallel, each test process uses its own disposable database named after the configured one plus `-p<pid>`, so files cannot clear each other's data.
- `test/helpers/fixtures.js` provides `build*` factories (plain objects, no database) and `create*` helpers (persisted) for users, admins, categories, products, addresses, carts, coupons, offers, orders, payments, wallets, ratings and wishlists.

To exercise the database-backed tests, point the suite at a throwaway MongoDB:

```bash
docker run -d --name toyhub-test-mongo -p 27017:27017 mongo:7
TEST_MONGO_URI=mongodb://127.0.0.1:27017/toyhub-test npm test
```

Without `TEST_MONGO_URI` the suite falls back to `mongodb://127.0.0.1:27017/toyhub-test` and the database tests skip themselves if nothing is listening.

### Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`. It performs a clean `npm ci`, verifies the bcrypt native binding, then runs `lint`, `test` and the startup smoke check against a MongoDB 7 service container. Every stage uses placeholder values defined in the workflow, so no repository secret is required and forked pull requests are safe; the workflow never deploys anything.

`Lint, test and startup checks` is the required status check for a pull request.

### Troubleshooting `bcrypt`

`bcrypt` is a native module, so its binding is compiled during install. npm 12 and newer block dependency install scripts unless they are approved, which produces:

```
Error: Cannot find module '.../node_modules/bcrypt/lib/binding/napi-v3/bcrypt_lib.node'
```

This repository allows that install script through the `allowScripts` field in `package.json`, so `npm ci` is enough. If the binding is still missing (after installing with `--ignore-scripts`, or on a machine without a matching prebuilt binary):

```bash
rm -rf node_modules && npm ci
npm rebuild bcrypt --build-from-source   # needs python3, make and a C/C++ compiler
npm run smoke
```

## Dependency audit

`npm audit` starts from a large, inherited report. The run that cleared it is
recorded here so the next person can tell a resolved finding from a known one.

Upgraded to a fixed version:

- `cloudinary` `1.x` → `2.11.0` (the `1.x` line is flagged high). The storage
  package `multer-storage-cloudinary@4` still declares a peer range of
  `cloudinary@^1.21.0`; it only calls the v2 uploader API that both lines
  provide, so the stale range is worked around with `legacy-peer-deps=true` in
  `.npmrc` and the upload path is exercised by `test/product-create.test.js`.
- `nodemailer` `6.x` → `10.1.0`.
- `jspdf` `2.x` → `4.2.1` and `jspdf-autotable` `3.x` → `5.0.8` (the old `jspdf`
  line is critical). Both call sites now use the function form
  `autoTable(doc, options)` instead of the removed `doc.autoTable`; the shape the
  call sites depend on is pinned by `test/pdf-export.test.js`.
- `bcrypt` `5.x` → `6.0.0`, which drops the `@mapbox/node-pre-gyp` installer and
  with it the critical `tar` advisory.

Remaining findings and why they are accepted:

- `tailwindcss`, `postcss-cli`, and their transitive `braces`, `chokidar`,
  `fast-glob`, `micromatch`, `postcss-nested`, `postcss-selector-parser` are
  development-only: no script in `package.json` builds CSS and no dependency
  ships them to production. Tailwind has no fixed release on the `3.x` line
  (only `3.4.19`, which is still in range), so clearing it means a `4.x` config
  migration; revisit by 2026-12-31.
- `exceljs` depends on `uuid@8`, below the fixed `11.1.1`. The advisory covers
  callers that pass their own `buf` to `v3`/`v5`/`v6`; `exceljs` calls `v4()`
  with no buffer, so the vulnerable path is unreachable. `exceljs` has no newer
  release; revisit when it widens the dependency.

Keep this list current when `npm audit` changes: run `npm audit`, fix what a
non-breaking upgrade can reach, and add an entry with a reason and a date for
anything left.

## Environment configuration

Copy `.env.example` to `.env` and provide the required values before starting the application. Required values are `NODE_ENV`, `MONGO_URI`, `SESSION_SECRET`, `CLIENT_ID`, `CLIENT_SECRET`, `CALLBACK_URL`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `RAZOR_KEY_ID`, and `RAZOR_SECRET_ID`.

`ADMIN_EMAIL` and `ADMIN_PASSWORD` are optional one-time bootstrap values for creating the first admin with a hashed password. Remove them from the environment after provisioning if they are no longer needed.

Never commit `.env` or real credentials. Rotate any credentials that were previously committed before deploying this application. `SECURITY.md` covers the production caveats, secret handling, and how to report a vulnerability.

## Sessions

Sessions are stored in MongoDB (`connect-mongo`, collection `sessions`), so login state is shared across restarts and multiple instances. Nothing is kept in process memory. The `vercel.json` deployment therefore works without sticky sessions, provided `MONGO_URI` and the other variables are set in the project environment.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | none (required) | `development`, `test`, `staging`, or `production`. Startup fails on any other value. |
| `SESSION_SECRET` | none (required) | At least 32 characters in `staging`/`production`. |
| `SESSION_COOKIE_NAME` | `toyhub.sid` | Session cookie name. |
| `SESSION_COOKIE_SAME_SITE` | `lax` | `lax`, `strict`, or `none`. `none` forces `Secure`. |
| `SESSION_COOKIE_SECURE` | `false` | Set to `true` to require HTTPS in development. Always on in `staging`/`production`. |
| `SESSION_MAX_AGE_MS` | `86400000` | Idle timeout in milliseconds; also the store TTL. |
| `SESSION_STORE_COLLECTION` | `sessions` | MongoDB collection for sessions. |
| `TRUST_PROXY` | `1` in `staging`/`production`, otherwise `false` | Reverse proxy hops to trust for `X-Forwarded-Proto`. |

Cookies are always `HttpOnly`. In `staging` and `production` they are also `Secure`, so TLS must terminate at the app or at the trusted proxy hop that `TRUST_PROXY` describes. Development keeps cookies non-`Secure` for `http://localhost`, and a production `Secure` policy is never applied implicitly.

Session identifiers are regenerated on login, and sessions are destroyed on logout, on password change or reset, and when an admin blocks an account.

The cookie name changed from the `connect.sid` default to `toyhub.sid`, so everyone is signed out once when this version is deployed.

## Deployment

The application is a single Express entry point, `server.js`. It validates its
configuration before it accepts traffic and needs no secrets compiled into the
code, so the same image can run in staging and production with different
environments.

- `assertRequiredEnv()` runs at startup and names every missing variable at once,
  so a misconfigured deploy fails immediately and loudly instead of 500-ing on
  the first request that happens to need a value. The required names are listed
  under [Environment configuration](#environment-configuration).
- `server.js` binds a port only when `VERCEL` is unset. On a serverless platform
  the exported app is what serves requests and the platform owns the socket; run
  with `npm start` anywhere a long-lived process is expected.
- Sessions live in MongoDB, so there are no sticky sessions and several
  instances can serve the same visitor. See [Sessions](#sessions) for the cookie
  and proxy rules.

### Health and readiness

Two probes answer the two questions a platform asks, and they are deliberately
not the same check:

| Endpoint | Answers | Response |
| --- | --- | --- |
| `GET /health` | Is the process still serving? Never reads the database. | `200 {"status":"ok"}` always, while the process is up. |
| `GET /ready` | Would a real request work? Reads the database connection. | `200 {"status":"ready"}`, or `503 {"status":"unavailable"}` while the database is away. |

Point the platform's liveness probe at `/health` and its readiness probe at
`/ready`. A short database outage then holds traffic back (readiness) without
restarting every instance (liveness). Both are registered before sessions and
CSRF, so a probe does not create a session or need a token.

### Integration configuration

Every external integration is configured by environment, so a deployment changes
behaviour without a code change:

| Integration | Variables | Where it is wired |
| --- | --- | --- |
| Database | `MONGO_URI` | `models/main.models.js`, `utils/session.js` |
| Sessions | `SESSION_*`, `TRUST_PROXY` | `utils/session.js` |
| Image uploads | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | `utils/cloudinary.js`, `utils/multer.js`, `utils/uploads.js` |
| Google OAuth | `CLIENT_ID`, `CLIENT_SECRET`, `CALLBACK_URL` | `utils/passport.js`, `routes/googleAuthRoute.js` |
| Mail | `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM` | `utils/mailer.js` |
| Payments | `RAZOR_KEY_ID`, `RAZOR_SECRET_ID` | `controllers/userModules/checkout.js` |

The OAuth `CALLBACK_URL` and the payment callback must be reachable from the
public internet and must match what is registered with Google and Razorpay;
preview or per-instance hostnames that are not registered are refused by the
provider.

### Deployment smoke checklist

After a deploy, in the target environment:

1. `GET /health` returns `200 {"status":"ok"}`.
2. `GET /ready` returns `200 {"status":"ready"}` (a `503` means the database is
   not reachable from this instance).
3. The landing page loads and a product page renders with its images.
4. Sign up, then sign in, and confirm the session survives a second request
   (cookie is `Secure`, `HttpOnly`, and named `toyhub.sid`).
5. Add a product with an image as an admin, and confirm the image is served from
   the configured Cloudinary cloud.
6. Complete a Razorpay test payment and confirm the order and wallet move once
   for it.
7. Trigger a password reset and confirm the mail arrives from `MAIL_FROM`.

## Adding a product

The add-product form and the Product schema use different words for the same
thing, and the translation between them is written down in
`utils/product-form.js` rather than spread through the request handler. A field
read under the name the form gives it and written under a name the schema does
not have is dropped by the database rather than saved, which is how warnings,
prices and pictures went missing.

| The form asks for | The product stores |
| --- | --- |
| `title` | `name` |
| `warning` | `warnings` |
| `sku` | `SKU` |
| `stock_quantity` | `stock` |
| `regular_price` | `price` |
| `description1`, `description2`, `type`, `color` | the same names |
| the files, and the crops of them | `images` |

`priceAfterDiscount` is worked out from the price and the discount in that one
file, so the shopper's pages, the product list and this form cannot each decide
what a discount means. The form used to also ask for a sale price, which nothing
read and which contradicted the discount; the page now shows the price the
product will be listed at instead.

**What is refused, and what it leaves behind.** A request is checked in full
before anything is written, so a refused one leaves no product and no category
changed. Each refusal is reported against the field that caused it, and the
values that were typed are handed back so the product is not typed twice. A
category that is not one of the shop's own is a mistake rather than a server
error, and a name already in use is said to be the name's problem.

**Pictures.** The form sends what was picked under `files` and the crops under
`croppedImage_0` to `croppedImage_4`, and the crops are what the product shows.
A file that was not cropped stands in for its own position rather than leaving a
hole. Uploads happen before the request can be checked, so `utils/uploads.js`
gives back the files no product points at: everything when the product was not
created, and the uncropped originals when it was. A refused upload is answered
by the upload itself, in the words of the field it belongs to.

**Editing a product.** The edit form is the same form, and it is read by the
same `utils/product-form.js`, so a field cannot mean one thing when a product is
added and another when it is changed. Two things the edit form used to do are
now written down rather than implied.

*What the shopper knows about a product is not the edit form's to set.* How much
has sold, how it is rated and which offers are on it belong to the shop's own
pages. An edit writes only the fields the form owns, so editing a price cannot
quietly reset a product's ratings.

**Which pictures an edit keeps.** The page shows the pictures the product holds,
each with a box ticked. The ticked ones are sent as `keepImages`, the whole list
it was showing as `knownImages`, and new pictures as `files` and `croppedImage_n`
exactly as the add form sends them. A picture nobody kept is removed, so removal
is something an administrator does on purpose rather than something that happens
when a field is missing. A request that names no pictures at all keeps all of
them, because it was a request about something else.

Only paths the product already holds can be kept: a path that arrives in a
request and is not one of this product's pictures is ignored and said so, so an
edit cannot point a product at somebody else's picture, nor take a picture off a
product that is not this one.

The two lists are both sent because one is not enough. An unticked checkbox is
posted as nothing at all, so without `knownImages`, unticking the only picture of
a product would be indistinguishable from a request that said nothing about
pictures, and the removal would be silently ignored.

**When a picture is removed from the image host.** Only after the product has been
saved. An image host cannot un-delete a picture, so removing one before the write
would leave a product pointing at a picture that is gone if the write then failed.
A stored picture is a delivery address; the name the host can remove is read back
out of it, and an address this shop did not put there is left alone rather than
asked about.

## Order records

An order is the record of what was bought, so it keeps the values as they were
at the time rather than reading them back off the product. Each line stores the
product's name, image and price, and an order stores the delivery address and
the coupon code that paid. A product can be renamed, discounted or deleted
afterwards and the order, the receipt and the invoice still read correctly.

`status` is one of `pending`, `cancelled`, `shipped`, `delivered`, and
`paymentMethod` is one of `razorpay`, `cod`, `wallet` (`ORDER_STATUSES` and
`PAYMENT_METHODS` in `models/orders.models.js`). The admin status form is
checked against that list before anything is written.

## Cancelling an order

An order changes state through `utils/order-transitions.js` and nowhere else, so
the question "may this order move to that state?" is answered once rather than
re-decided by each page. Every change is written by a conditional update that
names the state it is moving from, so a request that arrives twice makes the
change once and the second request gets the same answer the first one gave.

**Who may cancel.** A shopper may cancel an order or a line of it only while the
order is `pending` and only their own: an order that has been shipped, delivered
or cancelled cannot be called back, and the form is not even offered for one. An
administrator's cancellation is the same act on the same order, and goes through
the same code, so it releases the same stock and returns the same money. The
route is what makes the request an administrator's.

**Where the money goes.** Money is only given back for money that was actually
taken, and it goes back to where it came from:

| Order | What happens |
| --- | --- |
| `cod`, not paid | Nothing. No money was taken, so none is given. |
| `cod`, marked paid | Nothing. It was paid by hand on delivery; there is nothing to trace. |
| `razorpay`, not paid | Nothing. Refunding it would pay the shopper for an order they did not buy. |
| `razorpay`, paid | A refund through the gateway to the card that was charged, after the payment is read back to confirm it was captured. |
| `wallet`, paid | A credit to the balance it came out of, through the ledger entry keyed by the order. |

A card payment is not also credited to the balance, which would pay the shopper
twice for the same order.

**Once.** Each refund is claimed on the order before any money moves, and each
line carries its own claim because a line cancelled on its own is a refund of its
own share. Stock is returned under the same kind of claim, per line, so a line
that has already been called back is not returned again when the rest of the
order is. A refund the gateway refuses is recorded as `failed` with the reason
rather than reported as a failed cancellation: the order is cancelled either
way, and the refund can be asked for again.

**Lines.** Cancelling one line returns that line's share of what was paid, takes
it off the order's total, and returns only that line's stock. The share is
measured against the lines still in the order, so the last line out leaves
nothing behind. When the last line leaves, the order is cancelled and its total
is zero.

### Orders written by earlier versions

Earlier versions wrote `Pending`, `Cancelled`, `Shipped`, `Delivered`,
`completed` and `stock-unavailable`, kept a second copy of the buyer inside
`address.user`, and left `couponCode` null. Those records stay in the database
and stay readable:

- **Reading an old status.** `normaliseOrderStatus()` in
  `models/orders.models.js` maps every old word onto the four current ones, and
  anything unrecognised reads as `pending`. Every page and every decision that
  asks whether an order is still open goes through it, so nothing needs to know
  the history of the field. Nothing needs to be rewritten.
- **Reading an old buyer.** The buyer is read from the order's `user`
  reference and populated at the point of use, so the name and email shown are
  the account's own and current ones. The stale copy under `address.user` is
  ignored, and is no longer written.
- **Writing.** `status` and `paymentMethod` are enums, so a new record can only
  hold the current words. Legacy values already in the database still load
  (reading is not validated) and are re-saved in the current spelling the next
  time that order changes.
- **Cancelling an old order.** An order written before the refund note existed
  has no note, so "nothing refunded yet" means both "says `none`" and "says
  nothing". The same is true of the stock marker, so an old order can still be
  cancelled and its stock returned exactly once.

To rewrite the old words in place, without the read path:

```js
db.orders.updateMany({ status: "Delivered" }, { $set: { status: "delivered" } });
db.orders.updateMany({ status: "Cancelled" }, { $set: { status: "cancelled" } });
db.orders.updateMany({ status: "Pending" }, { $set: { status: "pending" } });
db.orders.updateMany({ status: "stock-unavailable" }, { $set: { status: "cancelled" } });
```

The old `address.user` copy and the `totalProductsBuyed`/`totalAmoutSpended`
counters on the user are left where they are; nothing reads them, so they can
be removed at any time with `db.orders.updateMany({}, { $unset: { "address.user": "" } })`.
