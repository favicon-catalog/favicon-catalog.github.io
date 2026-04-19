# Favicon Snapshots

This repository contains published favicon snapshot artifacts only.

- Source code, documentation, and release workflows live in [favicon-catalog.github.io](https://github.com/favicon-catalog/favicon-catalog.github.io).
- Browse the catalog UI at [https://favicon-catalog.github.io/](https://favicon-catalog.github.io/).
- Treat this repository as a public snapshot endpoint, not a development repository.

## How To Use

Use version-pinned URLs for stable integrations:

```text
https://cdn.jsdelivr.net/gh/favicon-catalog/favicons@<tag>/index.json
https://cdn.jsdelivr.net/gh/favicon-catalog/favicons@<tag>/<first-char>/<domain>/favicon.png
https://raw.githubusercontent.com/favicon-catalog/favicons/<tag>/index.json
```

GitHub Pages serves the latest published snapshot:

```text
https://favicon-catalog.github.io/favicons/index.json
https://favicon-catalog.github.io/favicons/<first-char>/<domain>/favicon.png
```

If you need the UI, browse the catalog site linked above. For development, contribution guidelines, and architecture details, use the source repository.
