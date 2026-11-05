# Deployment

The application is a single Express entry point, `server.js`. It validates its
configuration before it accepts traffic and needs no secrets compiled into the
code, so the same image can run in staging and production with different
environments.

- `assertRequiredEnv()` runs at startup and names every missing variable at once,
  so a misconfigured deploy fails immediately and loudly instead of 500-ing on
  the first request that happens to need a value. The required names are listed
  under [configuration.md](configuration.md).
- `server.js` binds a port only when `VERCEL` is unset. On a serverless platform
  the exported app is what serves requests and the platform owns the socket; run
  with `npm start` anywhere a long-lived process is expected.
- Sessions live in MongoDB, so there are no sticky sessions and several
  instances can serve the same visitor. See [configuration.md](configuration.md)
  for the cookie and proxy rules.

## Health and readiness

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

## Integration configuration

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

## Deployment smoke checklist

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
