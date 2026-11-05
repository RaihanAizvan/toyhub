# Testing

`npm test` works from a clean checkout with no configuration: the suite supplies
its own throwaway environment, so no production credentials are needed and
nothing reads a real `.env`.

- Tests live in `test/*.test.js` and run on the built-in `node:test` runner.
- `test/helpers/test-env.js` builds the test environment and refuses any MongoDB
  URI whose database name does not contain `test`, so a test run can never write
  to production data.
- `test/helpers/test-db.js` connects, clears and disconnects the test database,
  and skips database-backed tests with an explanatory message when no MongoDB is
  reachable. Because `node --test` runs test files in parallel, each test process
  uses its own disposable database named after the configured one plus `-p<pid>`,
  so files cannot clear each other's data.
- `test/helpers/fixtures.js` provides `build*` factories (plain objects, no
  database) and `create*` helpers (persisted) for users, admins, categories,
  products, addresses, carts, coupons, offers, orders, payments, wallets, ratings
  and wishlists.

To exercise the database-backed tests, point the suite at a throwaway MongoDB:

```bash
docker run -d --name toyhub-test-mongo -p 27017:27017 mongo:7
TEST_MONGO_URI=mongodb://127.0.0.1:27017/toyhub-test npm test
```

Without `TEST_MONGO_URI` the suite falls back to
`mongodb://127.0.0.1:27017/toyhub-test` and the database tests skip themselves if
nothing is listening.

## Continuous integration

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`. It
performs a clean `npm ci`, verifies the bcrypt native binding, then runs `lint`,
`test` and the startup smoke check against a MongoDB 7 service container. Every
stage uses placeholder values defined in the workflow, so no repository secret is
required and forked pull requests are safe; the workflow never deploys anything.

`Lint, test and startup checks` is the required status check for a pull request.

## Troubleshooting `bcrypt`

`bcrypt` is a native module, so its binding is compiled during install. npm 12
and newer block dependency install scripts unless they are approved, which
produces:

```
Error: Cannot find module '.../node_modules/bcrypt/lib/binding/napi-v3/bcrypt_lib.node'
```

This repository allows that install script through the `allowScripts` field in
`package.json`, so `npm ci` is enough. If the binding is still missing (after
installing with `--ignore-scripts`, or on a machine without a matching prebuilt
binary):

```bash
rm -rf node_modules && npm ci
npm rebuild bcrypt --build-from-source   # needs python3, make and a C/C++ compiler
npm run smoke
```
