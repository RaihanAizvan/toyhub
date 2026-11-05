# Dependency audit

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
