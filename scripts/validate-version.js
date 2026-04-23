#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import YAML from "yaml";

const execFileAsync = promisify(execFile);
const GITHUB_RELEASES_URL = "https://api.github.com/repos/favicon-catalog/favicons/releases/latest";
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-.]+))?(?:\+([0-9A-Za-z-.]+))?$/;

function parseSemver(value) {
  const match = SEMVER_RE.exec(value);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);

  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right);
  }
  if (leftNumeric) {
    return -1;
  }
  if (rightNumeric) {
    return 1;
  }
  return left.localeCompare(right);
}

function compareSemver(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    const diff = left[key] - right[key];
    if (diff !== 0) {
      return diff;
    }
  }

  if (left.prerelease.length === 0 && right.prerelease.length === 0) {
    return 0;
  }
  if (left.prerelease.length === 0) {
    return 1;
  }
  if (right.prerelease.length === 0) {
    return -1;
  }

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left.prerelease[index];
    const rightValue = right.prerelease[index];
    if (leftValue === undefined) {
      return -1;
    }
    if (rightValue === undefined) {
      return 1;
    }
    const diff = compareIdentifiers(leftValue, rightValue);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

async function getChangedFiles(baseSha, headSha) {
  const args = ["diff", "--name-only"];
  if (baseSha) {
    args.push(baseSha, headSha);
  } else {
    args.push("HEAD");
  }

  const { stdout } = await execFileAsync("git", args, { encoding: "utf8" });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function readSnapshotVersion() {
  const text = await readFile("snapshot/input/domains.yaml", "utf8");
  const parsed = YAML.parse(text);
  return typeof parsed?.version === "string" ? parsed.version.trim() : "";
}

async function fetchLatestReleaseVersion() {
  const response = await fetch(GITHUB_RELEASES_URL, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "favicon-catalog-version-check",
    },
  });

  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`failed to fetch latest release: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const tag = typeof payload?.tag_name === "string" ? payload.tag_name.trim() : "";
  return tag.startsWith("v") ? tag.slice(1) : tag || null;
}

function hasCatalogChanges(changedFiles) {
  return changedFiles.some((path) => path.startsWith("site/") || path === "vite.config.js");
}

function hasPackageVersionChange(changedFiles) {
  return changedFiles.includes("package.json");
}

function hasSnapshotVersionChange(changedFiles) {
  return changedFiles.includes("snapshot/input/domains.yaml");
}

function hasSnapshotChanges(changedFiles) {
  return changedFiles.some((path) => path.startsWith("snapshot/") && path !== "snapshot/README.md" && path !== "snapshot/.nojekyll");
}

async function main() {
  const baseSha = process.env.BASE_SHA ?? "";
  const headSha = process.env.HEAD_SHA ?? "HEAD";
  const changedFiles = await getChangedFiles(baseSha, headSha);

  if (changedFiles.length > 0) {
    console.log(changedFiles.join("\n"));
  } else {
    console.log("");
    return;
  }

  if (hasCatalogChanges(changedFiles) && !hasPackageVersionChange(changedFiles)) {
    throw new Error("Catalog site files changed, but package.json was not updated.");
  }

  if (!hasSnapshotChanges(changedFiles) && !hasSnapshotVersionChange(changedFiles)) {
    return;
  }

  const latestVersion = await fetchLatestReleaseVersion();
  if (!latestVersion) {
    return;
  }

  const snapshotVersion = await readSnapshotVersion();
  const latestSemver = parseSemver(latestVersion);
  const snapshotSemver = parseSemver(snapshotVersion);
  if (!snapshotSemver) {
    throw new Error(`snapshot/input/domains.yaml version must be a valid semver string: ${snapshotVersion}`);
  }
  if (!latestSemver) {
    throw new Error(`latest published release version is not valid semver: ${latestVersion}`);
  }
  if (compareSemver(snapshotSemver, latestSemver) <= 0) {
    throw new Error(`snapshot/input/domains.yaml version (${snapshotVersion}) must be greater than the latest release version (${latestVersion}) in favicon-catalog/favicons.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
