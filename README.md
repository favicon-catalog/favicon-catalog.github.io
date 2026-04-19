# Favicon Catalog

This repository (`favicon-catalog.github.io`) is the main source repository for the Favicon Catalog project.
It hosts the catalog site at `https://favicon-catalog.github.io/` and owns the project documentation, site code, and published snapshot integration.

Snapshot data is published from the [favicons](https://github.com/favicon-catalog/favicons) repository.
Snapshot source files also live under [`snapshot/`](/root/ws/favicon-catalog/favicon-catalog.github.io/snapshot/domains.txt) inside this repository.

## CI/CD Workflows

Currently, snapshot publishing is triggered **manually**, while site deployment happens automatically when code is merged to the `main` branch.

### 1. Validate Workflow
Runs on PRs and pushes to `main` to ensure code builds and snapshot pipelines are healthy.

```mermaid
flowchart TD
    PR([Pull Request]) --> Val[Build Site & Validate Snapshot Pipeline]
    PushMain([Push to main]) --> Val
```

### 2. Deploy Workflow
Automatically publishes the site to GitHub Pages whenever changes hit the `main` branch.

```mermaid
flowchart TD
    PushMainDeploy([Push to main]) --> BuildSite[Build Site Assets]
    BuildSite --> Pages[Deploy to GitHub Pages]
```

### 3. Publish Workflow
Currently requires a **manual trigger** to publish new favicons snapshot data to the external repository.

```mermaid
flowchart TD
    Manual([Manual / workflow_dispatch]) --> CheckTag{Tag Exists?}
    CheckTag -- No --> Gen[Generate Snapshot Artifacts]
    Gen --> Push[Push to favicon-catalog/favicons]
    Push --> TagReq[Create GitHub Tag & Release]
    CheckTag -- Yes --> Skip[Skip Publish]
```

## How To Use

Browse the published catalog at:

```text
https://favicon-catalog.github.io/
```

To consume published snapshot data directly, use:

```text
https://cdn.jsdelivr.net/gh/favicon-catalog/favicons@<tag>/index.json
https://cdn.jsdelivr.net/gh/favicon-catalog/favicons@<tag>/<first-char>/<domain>/favicon.png
https://raw.githubusercontent.com/favicon-catalog/favicons/<tag>/index.json
https://favicon-catalog.github.io/favicons/index.json
https://favicon-catalog.github.io/favicons/<first-char>/<domain>/favicon.png
```

Use `index.json` to enumerate published domains. Use the representative PNG path when you need one stable favicon image per domain.

The catalog provides search, pagination, and direct links to each domain's representative PNG and manifest.
It also provides per-domain detail pages, JSON dialogs for `index.json` and per-domain manifests, and direct download/copy actions.

Current catalog behavior:

- list and detail views
- URL-synced detail pages such as `/apps.apple.com`
- search with compact match summary
- direct download links for individual icon files
- manifest and index dialogs with `Copy`, `Download`, and `Close` actions
- clickable URLs inside JSON dialogs
- related domain navigation in the detail view
- brand logo and site favicon provided by `site/public/logo.svg`

## Local Development

For local development, install dependencies and start the Vite dev server:

```bash
npm install
npm run dev
```

That serves the catalog at `http://127.0.0.1:8080/`. By default, the application fetches snapshot data from `https://favicon-catalog.github.io/favicons/`. 

To use local snapshots, test the `VITE_SNAPSHOT_BASE_URL` environment variable.

Common site commands:

```bash
npm run dev
npm run build
npm run preview
```

## Maintain Snapshots

The snapshot source of truth lives under `snapshot/`.

Run `make check` before opening a pull request. It performs the same repository-level checks enforced by the `Validate` workflow in CI.

Compatibility aliases are also available:

```bash
npm run site
npm run site-preview
```

Use these commands when working on snapshot data and release logic:

```bash
make -C snapshot validate
make -C snapshot test
make -C snapshot release
```

Common maintenance entry points:

- domain list: [`snapshot/domains.txt`](/root/ws/favicon-catalog/favicon-catalog.github.io/snapshot/domains.txt)
- snapshot version: [`snapshot/SNAPSHOT_VERSION`](/root/ws/favicon-catalog/favicon-catalog.github.io/snapshot/SNAPSHOT_VERSION)
- snapshot commands: [`snapshot/Makefile`](/root/ws/favicon-catalog/favicon-catalog.github.io/snapshot/Makefile)
- pipeline code: [`snapshot/src/`](/root/ws/favicon-catalog/favicon-catalog.github.io/snapshot/src/cli.js)

To add or update domains, edit [`snapshot/domains.txt`](/root/ws/favicon-catalog/favicon-catalog.github.io/snapshot/domains.txt) and open a pull request. Run `make check` before opening the PR if you want to validate the same local checks enforced in CI.

The published snapshot repository at [favicons](https://github.com/favicon-catalog/favicons) is an artifact endpoint. Its published `README.md` is copied from [snapshot/README.md](/root/ws/favicon-catalog/favicon-catalog.github.io/snapshot/README.md), and its published license is copied from the repository root [LICENSE](/root/ws/favicon-catalog/favicon-catalog.github.io/LICENSE).

Snapshot release model:

- source pipeline under `snapshot/`
- published artifacts in `favicon-catalog/favicons`
- snapshot version owned by [`snapshot/SNAPSHOT_VERSION`](/root/ws/favicon-catalog/favicon-catalog.github.io/snapshot/SNAPSHOT_VERSION)

## Catalog UI

The published catalog is a static site built from `site/` and served via GitHub Pages at root domain.

Main interactions:

- search field with list/detail view toggle
- detail pages with route-backed URLs
- manifest trigger from the detail header
- related domains section in detail view
- JSON dialogs render URL strings as clickable links that open in a new tab

Detail routes use the published base path plus the encoded domain:

```text
/<domain>
```

Example:

```text
https://favicon-catalog.github.io/apps.apple.com
```

## Notice

Favicons referenced by this project may be trademarks of their respective owners, and no affiliation with or endorsement by those owners is implied.
