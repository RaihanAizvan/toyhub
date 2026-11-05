# Architecture

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
  See [probes.md](probes.md).

## Project layout

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
├── docs/                  These documents
├── .env.example           Every supported environment variable, with empty values
└── .github/workflows/     Continuous integration (lint, test, startup checks)
```
