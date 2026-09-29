# ToyHub

ToyHub is a fully functional e-commerce platform designed to sell toys online. This project is built using the MERN stack (MongoDB, Express, React, Node.js) with a focus on creating a comprehensive platform for both users and administrators. It includes features such as user authentication, product management, and a responsive user interface.

## Table of Contents

- [Features](#features)
- [Project Structure](#project-structure)
- [Running locally](#running-locally)
- [Testing](#testing)
- [Environment configuration](#environment-configuration)
- [Usage](#usage)
- [Technologies Used](#technologies-used)
- [API Documentation](#api-documentation)
- [License](#license)

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

## Project Structure
TOYHUB<br>
│<br>
├── config<br>
│<br>
├── controllers<br>
│<br>
├── middlewares<br>
│<br>
├── models<br>
│<br>
├── node_modules<br>
│<br>
├── public<br>
│   ├── css<br>
│   ├── images<br>
│   └── js<br>
│<br>
├── routes<br>
│   └── admin.js<br>
│<br>
├── services<br>
│<br>
├── tests<br>
│   ├── integration<br>
│   │   └── auth.test.js<br>
│   └── unit<br>
│       ├── product.test.js<br>
│       └── user.test.js<br>
│<br>
├── utils<br>
│<br>
└── views<br>
    ├── auth<br>
    │   ├── login.ejs<br>
    │   └── signup.ejs<br>
    │<br>
    ├── layouts<br>
    │   └── main.ejs<br>
    │<br>
    ├── partials<br>
    │   ├── footer.ejs<br>
    │   └── header.ejs<br>
    │<br>
    └── products<br>
        ├── productDetails.ejs<br>
        └── index.ejs

------------------------------
  1. Clone the repository:
     ```bash
     git clone https://github.com/RaihanAizvan/toyhub.git
  2. Navigate to the project directory:
  3. Install the required dependencies:
  4. Set up environment variables:
   - Create a `.env` file in the root directory.
   - Add the following environment variables:
  5. Start the development server:
  6. Access the application:
   Open your web browser and go to http://localhost:3000 to view the ToyHub platform.

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

## Environment configuration

Copy `.env.example` to `.env` and provide the required values before starting the application. Required values are `NODE_ENV`, `MONGO_URI`, `SESSION_SECRET`, `CLIENT_ID`, `CLIENT_SECRET`, `CALLBACK_URL`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `RAZOR_KEY_ID`, and `RAZOR_SECRET_ID`.

`ADMIN_EMAIL` and `ADMIN_PASSWORD` are optional one-time bootstrap values for creating the first admin with a hashed password. Remove them from the environment after provisioning if they are no longer needed.

Never commit `.env` or real credentials. Rotate any credentials that were previously committed before deploying this application.

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
