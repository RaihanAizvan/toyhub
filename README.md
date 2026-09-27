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
