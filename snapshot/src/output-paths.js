import { DEFAULT_DIST_DIR } from "./config.js";
import { readSnapshotVersion } from "./index-metadata.js";

export async function resolveOutputPaths({ versionPath } = {}) {
  const releaseVersion = await readSnapshotVersion(versionPath);
  return {
    releaseVersion,
    outputRoot: DEFAULT_DIST_DIR,
    iconsDir: DEFAULT_DIST_DIR,
    indexPath: `${DEFAULT_DIST_DIR}/index.json`,
  };
}
