# Favicon Catalog Frontend

This repository (`favicon-catalog.github.io`) hosts the web catalog UI for domain favicons, published precisely at the root URL `https://favicon-catalog.github.io/`. 
It renders data consumed from the external data repository `favicons`.

## How To Use

Browse the published catalog at:

```text
https://favicon-catalog.github.io/
```

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
npm run site-preview
```

That serves the catalog at `http://127.0.0.1:4173/`. By default, the application fetches snapshot data from `https://favicon-catalog.github.io/favicons/`. 

To use local snapshots, test the `VITE_SNAPSHOT_BASE_URL` environment variable.

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
