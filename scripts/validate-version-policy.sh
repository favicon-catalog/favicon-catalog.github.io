#!/usr/bin/env bash
set -euo pipefail

BASE_SHA="${BASE_SHA:-}"
HEAD_SHA="${HEAD_SHA:-HEAD}"

if [ -z "$BASE_SHA" ]; then
  if git rev-parse --verify HEAD^ >/dev/null 2>&1; then
    BASE_SHA="$(git rev-parse HEAD^)"
  else
    echo "BASE_SHA is required when the repository has fewer than two commits." >&2
    exit 1
  fi
fi

changed_files="$(git diff --name-only "$BASE_SHA" "$HEAD_SHA")"
echo "$changed_files"

if [ -z "$changed_files" ]; then
  exit 0
fi

package_changed=false
snapshot_version_changed=false
catalog_changed=false
snapshot_changed=false

while IFS= read -r path; do
  [ -z "$path" ] && continue

  if [ "$path" = "package.json" ]; then
    package_changed=true
  fi

  if [ "$path" = "snapshot/SNAPSHOT_VERSION" ]; then
    snapshot_version_changed=true
  fi

  case "$path" in
    site/*|vite.config.js)
      catalog_changed=true
      ;;
  esac

  case "$path" in
    snapshot/SNAPSHOT_VERSION|snapshot/README.md|snapshot/.nojekyll)
      ;;
    snapshot/*)
      snapshot_changed=true
      ;;
  esac
done <<EOF
$changed_files
EOF

if [ "$catalog_changed" = "true" ] && [ "$package_changed" != "true" ]; then
  echo "Catalog site files changed, but package.json was not updated." >&2
  exit 1
fi

if [ "$snapshot_changed" = "true" ] && [ "$snapshot_version_changed" != "true" ]; then
  echo "Snapshot files changed, but snapshot/SNAPSHOT_VERSION was not updated." >&2
  exit 1
fi
