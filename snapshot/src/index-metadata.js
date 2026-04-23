import path from "node:path";
import { DEFAULT_DOMAINS_FILE } from "./config.js";
import { readSnapshotInputFile } from "./input-file.js";
import { formatManifestJson, utcTimestamp } from "./json.js";

export const DEFAULT_VERSION_FILE = DEFAULT_DOMAINS_FILE;
export const INDEX_METADATA_PATH = "index.json";

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

export async function readSnapshotVersion(versionPath = DEFAULT_VERSION_FILE) {
  let snapshotInput;
  try {
    snapshotInput = await readSnapshotInputFile(versionPath);
  } catch (error) {
    throw new Error(`failed to read ${versionPath}: ${error.message}`);
  }
  const version = snapshotInput.version ?? "";
  if (!SEMVER_RE.test(version)) {
    throw new Error(`snapshot version must be a valid semver string: ${versionPath}`);
  }
  return version;
}

export function buildReleaseTag(releaseVersion) {
  const version = typeof releaseVersion === "string" ? releaseVersion.trim() : "";
  if (!SEMVER_RE.test(version)) {
    throw new Error(`release version must be a valid semver string: ${releaseVersion}`);
  }
  return `v${version}`;
}

export function buildIndexMetadata(domains, releaseVersion) {
  return {
    tag: buildReleaseTag(releaseVersion),
    exported_at: utcTimestamp(),
    domain_count: domains.length,
    domains: [...domains],
  };
}

export async function writeIndexMetadataFile(indexMetadata, outputPath = INDEX_METADATA_PATH) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${formatManifestJson(indexMetadata)}\n`, "utf8");
}
