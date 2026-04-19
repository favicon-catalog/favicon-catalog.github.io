#!/usr/bin/env node

import * as countSizes from "./count-sizes.js";
import * as download from "./download.js";
import * as validate from "./validate.js";

const [, , command, ...rest] = process.argv;

function printHelp() {
  console.log("Usage: collection <command> [options]");
  console.log("");
  console.log("Commands:");
  console.log("  validate   Validate the domains input file");
  console.log("  sizes      Count collected sizes across manifests");
  console.log("  release    Build the release snapshot in dist/");
  console.log("  release-sample  Build a sample snapshot in dist/");
}

async function main() {
  switch (command) {
    case undefined:
    case "-h":
    case "--help":
      printHelp();
      return 0;
    case "validate":
      return validate.main(rest);
    case "sizes":
      return countSizes.main(rest);
    case "release":
      return download.main(rest);
    case "release-sample":
      return download.main(["--sample", ...rest]);
    case "download":
      return download.main(rest);
    default:
      console.log(`Unknown command: ${command}`);
      printHelp();
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error.stack || String(error));
    process.exitCode = 1;
  });
