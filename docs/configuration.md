# Configuration

## Environment variables

Copy `.env.example` to `.env` and provide the required values before starting the
application. Required values are `NODE_ENV`, `MONGO_URI`, `SESSION_SECRET`,
`CLIENT_ID`, `CLIENT_SECRET`, `CALLBACK_URL`, `MAIL_USER`, `MAIL_PASSWORD`,
`MAIL_FROM`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`,
`CLOUDINARY_API_SECRET`, `RAZOR_KEY_ID`, and `RAZOR_SECRET_ID`.

`ADMIN_EMAIL` and `ADMIN_PASSWORD` are optional one-time bootstrap values for
creating the first admin with a hashed password. Remove them from the environment
after provisioning if they are no longer needed.

Never commit `.env` or real credentials. Rotate any credentials that were
previously committed before deploying this application. `SECURITY.md` covers the
production caveats, secret handling, and how to report a vulnerability.

## Sessions

Sessions are stored in MongoDB (`connect-mongo`, collection `sessions`), so login
state is shared across restarts and multiple instances. Nothing is kept in process
memory. The `vercel.json` deployment therefore works without sticky sessions,
provided `MONGO_URI` and the other variables are set in the project environment.

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

Cookies are always `HttpOnly`. In `staging` and `production` they are also
`Secure`, so TLS must terminate at the app or at the trusted proxy hop that
`TRUST_PROXY` describes. Development keeps cookies non-`Secure` for
`http://localhost`, and a production `Secure` policy is never applied implicitly.

Session identifiers are regenerated on login, and sessions are destroyed on
logout, on password change or reset, and when an admin blocks an account.

The cookie name changed from the `connect.sid` default to `toyhub.sid`, so
everyone is signed out once when this version is deployed.
