import { promises as fs } from "node:fs";
import path from "node:path";
import {
  DEFAULT_INPUT_FILE,
} from "./config.js";
import {
  inspectDomainFolder,
  validateInputFile,
} from "./download.js";
import {
  buildIndexMetadata,
  buildReleaseTag,
  DEFAULT_VERSION_FILE,
  INDEX_METADATA_PATH,
  readSnapshotVersion,
  writeIndexMetadataFile,
} from "./index-metadata.js";
import { relativeFolderPath, targetFolder } from "./layout.js";
import { DEFAULT_DIST_DIR } from "./config.js";

export const DEFAULT_EXPORT_DIR = "dist/assets";
export { buildReleaseTag, readSnapshotVersion };

function isSamePathOrDescendant(parentPath, targetPath) {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isFilesystemRoot(targetPath) {
  const resolved = path.resolve(targetPath);
  return resolved === path.parse(resolved).root;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function ensureCleanDirectory(targetPath, force) {
  if (await pathExists(targetPath)) {
    if (!force) {
      throw new Error(`output path already exists: ${targetPath} (pass --force to replace it)`);
    }
    await fs.rm(targetPath, { recursive: true, force: true });
  }
  await fs.mkdir(targetPath, { recursive: true });
}

export async function validateExportState(inputPath, iconsPath) {
  const issues = [];

  if (!(await pathExists(inputPath))) {
    return [`missing input file: ${inputPath}`];
  }
  if (!(await pathExists(iconsPath))) {
    return [`missing icons directory: ${iconsPath}`];
  }

  const [domains, inputIssues] = await validateInputFile(inputPath);
  issues.push(...inputIssues.map((issue) => `${inputPath}: ${issue}`));

  if (domains.length === 0) {
    issues.push(`input file has no domains: ${inputPath}`);
    return issues;
  }

  for (const domain of domains) {
    const expectedFolder = targetFolder(iconsPath, domain);
    const [folder, manifest, issue] = await inspectDomainFolder(domain, iconsPath);
    if (!folder) {
      issues.push(`missing domain folder for ${domain}: ${expectedFolder}`);
      continue;
    }
    if (relativeFolderPath(folder) !== relativeFolderPath(expectedFolder)) {
      issues.push(`domain folder mismatch for ${domain}: ${relativeFolderPath(folder)} != ${relativeFolderPath(expectedFolder)}`);
      continue;
    }
    if (issue) {
      issues.push(`${domain}: ${issue}`);
      continue;
    }
    if (!manifest) {
      issues.push(`${domain}: missing manifest data`);
    }
  }
  return issues;
}

async function copyExportTree(outputPath, iconsPath, inputPath) {
  const iconsDirName = path.basename(iconsPath);
  await fs.cp(iconsPath, path.join(outputPath, iconsDirName), { recursive: true });
  const inputDirName = path.basename(path.dirname(inputPath));
  const inputOutputDir = path.join(outputPath, inputDirName);
  await fs.mkdir(inputOutputDir, { recursive: true });
  await fs.copyFile(inputPath, path.join(inputOutputDir, path.basename(inputPath)));
}

async function countExportedFiles(root) {
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

export function outputPathIsSafe(outputPath, inputPath, iconsPath) {
  const resolvedOutput = path.resolve(outputPath);
  if (isFilesystemRoot(resolvedOutput)) {
    return false;
  }
  const sourcePaths = new Set([
    path.resolve(inputPath),
    path.resolve(path.dirname(inputPath)),
    path.resolve(iconsPath),
  ]);
  return ![...sourcePaths].some(
    (sourcePath) => isSamePathOrDescendant(resolvedOutput, sourcePath)
      || isSamePathOrDescendant(sourcePath, resolvedOutput),
  );
}

export async function runExport({
  outputPath = DEFAULT_EXPORT_DIR,
  force = false,
  inputPath = DEFAULT_INPUT_FILE,
  iconsPath,
  versionPath = DEFAULT_VERSION_FILE,
} = {}) {
  const resolvedIconsPath = iconsPath || DEFAULT_DIST_DIR;
  if (!outputPathIsSafe(outputPath, inputPath, resolvedIconsPath)) {
    throw new Error(`output path must not overwrite or contain the source collection tree: ${outputPath}`);
  }

  const issues = await validateExportState(inputPath, resolvedIconsPath);
  if (issues.length > 0) {
    throw new Error(`Export validation failed:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
  }

  await ensureCleanDirectory(outputPath, force);
  await copyExportTree(outputPath, resolvedIconsPath, inputPath);
  const [domains] = await validateInputFile(inputPath);
  const releaseVersion = await readSnapshotVersion(versionPath);
  const indexMetadata = buildIndexMetadata(domains, releaseVersion);
  const indexMetadataPath = path.join(outputPath, INDEX_METADATA_PATH);
  await writeIndexMetadataFile(indexMetadata, indexMetadataPath);

  return {
    domainCount: domains.length,
    fileCount: await countExportedFiles(outputPath),
    outputPath,
    indexMetadata,
  };
}
