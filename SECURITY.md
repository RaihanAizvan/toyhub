# Security Policy

## Supported versions

ToyHub is a single deployment built from the `main` branch. Only the latest
commit on `main` receives security fixes; there are no maintained release
branches.

| Version | Supported |
| --- | --- |
| Latest `main` | :white_check_mark: |
| Anything else | :x: |

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(the repository's **Security** tab, then **Report a vulnerability**), or email the
maintainers if that is unavailable.

A useful report includes:

- what the issue is, and where it is (a file, a route, or a page);
- the steps that reproduce it;
- the impact you believe it has;
- any fix you would suggest.

What to expect:

- acknowledgement within a few days;
- an assessment, and for a confirmed issue a fix on `main` with a test that
  fails without it;
- credit in the advisory, unless you ask to stay anonymous.

Do not include real credentials or customer data, and do not run an exploit
against a live deployment.

## Handling secrets

- Never commit `.env` or real credentials. `.env` is gitignored and
  `.env.example` lists the variable names only, with empty values.
- Treat anything that was ever committed as compromised and rotate it before
  deploying: it stays in the git history even after it is removed.
- The values that matter most if leaked are `SESSION_SECRET` (it signs session
  cookies), `MONGO_URI` (database access), the Cloudinary keys, the Google OAuth
  client secret, the mail password, and `RAZOR_SECRET_ID`.

## Production caveats

Deploying the application is not, by itself, deploying it securely. Before a
real deployment:

- **Set `NODE_ENV=production`.** Startup then requires a `SESSION_SECRET` of at
  least 32 characters and marks cookies `Secure`, so TLS must terminate at the
  app or at the trusted proxy hop named by `TRUST_PROXY`.
- **Serve over HTTPS.** A `Secure` cookie is not sent over plain HTTP, so on an
  `http://` origin login will appear to do nothing.
- **Remove `ADMIN_EMAIL` and `ADMIN_PASSWORD`** once the first admin exists; they
  are a one-time bootstrap, not a running password.
- **Mind the Content Security Policy.** It still allows `'unsafe-inline'` for
  scripts because the views carry inline handlers. Treat that as a known,
  tracked weakness rather than a strong guarantee.
- **Set `TRUST_PROXY` to the real proxy hop count.** Trusting more hops than you
  run lets a client spoof `X-Forwarded-*`, including the client address.
- **Keep dependencies patched.** Review the output of `npm audit` as part of
  upkeep and avoid unreviewed major upgrades driven only by the audit.
