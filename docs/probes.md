# Probe and walkthrough scripts

Three scripts boot the real application and drive it by hand, to catch the things
a unit test does not: a page that answers `200` with an error inside it, or a
screen that only breaks when a reference has been deleted underneath it.

| Script | What it does |
| --- | --- |
| `node scripts/probe-user-pages.js` | Seeds the awkward shopper states (empty cart, no address, a withdrawn product, a deleted category, an order whose customer is gone), then visits every shopper page and checks the answer. |
| `node scripts/probe-admin-pages.js` | Signs in as an administrator and walks every admin page and action, including the destructive ones (create, edit, rename, delete a category or product). |
| `node scripts/walk-signup-flow.js` | Walks the signup-and-sign-in flow a person actually walks - real routes, real session, real CSRF token - with the email captured instead of sent. |

Each one starts the app on a port of its own (`PROBE_PORT`, default `3699` for
the shopper probe and `3599` for the admin probe; `WALK_PORT`, default `3457` for
the walkthrough) so it does not fight the server you already have running. The
process exits non-zero if anything failed.

## They use their own database

These scripts seed and delete data, so they must never touch a real database.
`scripts/probe-env.js` runs before the app is imported and chooses the database:

- If `TEST_MONGO_URI` is set, it is used as given.
- Otherwise the configured `MONGO_URI` is reread as a sibling named after it plus
  `-probe` (so `.../ToyHub` becomes `.../ToyHub-probe`).
- If the resulting name does not say `test` or `probe`, the script refuses to
  run.

There is nothing to do to opt in: run a probe and it lands on the scratch
database. If you are working against a local MongoDB, pointing `TEST_MONGO_URI`
at it keeps everything on your machine:

```bash
TEST_MONGO_URI=mongodb://127.0.0.1:27017/toyhub-test node scripts/probe-user-pages.js
```
