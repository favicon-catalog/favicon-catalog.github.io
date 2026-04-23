import { promises as fs } from "node:fs";
import { dump } from "js-yaml";
import YAML from "yaml";
import { DEFAULT_DOMAINS_FILE } from "./config.js";

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

export function parseSnapshotInputDocument(value) {
  const issues = [];

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      version: null,
      domains: null,
      issues: ["input root must be an object"],
    };
  }

  const version = typeof value.version === "string" ? value.version.trim() : "";
  if (!SEMVER_RE.test(version)) {
    issues.push("version must be a valid semver string");
  }

  const domains = Array.isArray(value.domains) ? value.domains : null;
  if (domains === null) {
    issues.push("domains must be a list");
  }

  return {
    version: version || null,
    domains,
    issues,
  };
}

export async function readSnapshotInputFile(inputPath = DEFAULT_DOMAINS_FILE) {
  const text = await fs.readFile(inputPath, "utf8");
  const parsed = YAML.parse(text);
  return parseSnapshotInputDocument(parsed);
}

export function stringifySnapshotInputFile({ version, domains }) {
  return dump(
    { version, domains },
    {
      noArrayIndent: true,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
    },
  );
}

export async function writeSnapshotInputFile(input, inputPath = DEFAULT_DOMAINS_FILE) {
  await fs.writeFile(inputPath, stringifySnapshotInputFile(input), "utf8");
}

export async function checkSnapshotInputFileFormatting(inputPath = DEFAULT_DOMAINS_FILE) {
  const text = await fs.readFile(inputPath, "utf8");
  const parsed = YAML.parse(text);
  const snapshotInput = parseSnapshotInputDocument(parsed);
  if (snapshotInput.issues.length > 0) {
    return {
      formatted: false,
      issues: snapshotInput.issues,
      expected: null,
      actual: text,
    };
  }

  const expected = stringifySnapshotInputFile(snapshotInput);
  return {
    formatted: text === expected,
    issues: [],
    expected,
    actual: text,
  };
}
