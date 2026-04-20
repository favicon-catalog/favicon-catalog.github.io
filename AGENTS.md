# AGENTS

This repository has two distinct areas:

- `site/`: static catalog UI built with Vite
- `snapshot/`: snapshot pipeline and published artifact source

Tech and implementation guidance:

- Keep `site/` changes in vanilla JavaScript and plain CSS unless a framework change is explicitly requested.
- Prefer Node core modules in `snapshot/` unless an external dependency is clearly justified.

Use these commands for validation:

```bash
make dev
make check
make -C snapshot validate
make -C snapshot test
```

Before wrapping up code changes, run `make check`.
If you change logic under `snapshot/src/`, also run `make -C snapshot test` and update tests when needed.

Version policy:

- If you change the catalog site (`site/` or `vite.config.js`), bump `package.json`.
- If you change snapshot sources under `snapshot/`, bump `snapshot/SNAPSHOT_VERSION`.
- The version policy is enforced by `scripts/validate-version-policy.sh` through `make check`.

Publish model:

- Pushes to `main` run validation and deploy the site to GitHub Pages.
- Pushes to `main` also run snapshot publishing.
- Snapshot publishing uses `snapshot/SNAPSHOT_VERSION` to decide the release tag.
- Published snapshot artifacts are pushed to the external `favicon-catalog/favicons` repository.

Important files:

- `README.md`: main project documentation
- `snapshot/README.md`: copied to the published snapshot repository
- `.github/workflows/`: CI/CD behavior
- `.github/pull_request_template.md`: contributor checklist

Editing guidance:

- Keep README sections ordered for readers: general usage first, contributor and CI details later.
- Keep terminology consistent: use `snapshot` for the release artifact unit.
- Prefer small, direct wording changes over broad rewrites unless structure is clearly wrong.
