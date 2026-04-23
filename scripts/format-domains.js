#!/usr/bin/env node

import {
  checkSnapshotInputFileFormatting,
  readSnapshotInputFile,
  writeSnapshotInputFile,
} from "../snapshot/src/input-file.js";

const CHECK_MODE = process.argv.includes("--check");
const DOMAINS_PATH = "snapshot/input/domains.yaml";

async function main() {
  if (CHECK_MODE) {
    const result = await checkSnapshotInputFileFormatting(DOMAINS_PATH);
    if (result.issues.length > 0) {
      throw new Error(`snapshot/input/domains.yaml is invalid:\n- ${result.issues.join("\n- ")}`);
    }
    if (!result.formatted) {
      throw new Error("snapshot/input/domains.yaml is not formatted. Run `node ./scripts/format-domains.js`.");
    }
    return;
  }

  const snapshotInput = await readSnapshotInputFile(DOMAINS_PATH);
  if (snapshotInput.issues.length > 0) {
    throw new Error(`snapshot/input/domains.yaml is invalid:\n- ${snapshotInput.issues.join("\n- ")}`);
  }
  await writeSnapshotInputFile(snapshotInput, DOMAINS_PATH);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
