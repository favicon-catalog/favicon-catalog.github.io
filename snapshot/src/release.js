import { promises as fs } from "node:fs";
import path from "node:path";
import { INDEX_METADATA_PATH } from "./index-metadata.js";
import { DEFAULT_DIST_DIR } from "./config.js";

export const RELEASE_BRANCH = "release";

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function countFiles(root) {
  let count = 0;

  async function walk(targetPath) {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextPath = path.join(targetPath, entry.name);
      if (entry.isDirectory()) {
        await walk(nextPath);
      } else if (entry.isFile()) {
        count += 1;
      }
    }
  }

  await walk(root);
  return count;
}

export async function stageRelease({
  outputPath = DEFAULT_DIST_DIR,
} = {}) {
  const indexPath = path.join(outputPath, INDEX_METADATA_PATH);
  if (!(await pathExists(indexPath))) {
    throw new Error(`missing snapshot index: ${indexPath}`);
  }
  const indexMetadata = JSON.parse(await fs.readFile(indexPath, "utf8"));
  return {
    domainCount: indexMetadata.domain_count,
    fileCount: await countFiles(outputPath),
    outputPath,
    indexMetadata,
  };
}
