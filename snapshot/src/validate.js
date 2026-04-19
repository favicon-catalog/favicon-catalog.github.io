import { DEFAULT_INPUT_FILE } from "./config.js";
import { validateInputFile } from "./download.js";

export async function main(argv = []) {
  if (argv.length > 0) {
    console.log(`Unknown argument: ${argv[0]}`);
    return 1;
  }
  const inputPath = DEFAULT_INPUT_FILE;
  let domains;
  let issues;
  try {
    [domains, issues] = await validateInputFile(inputPath);
  } catch {
    console.log(`Input file not found: ${inputPath}`);
    return 1;
  }
  if (issues.length > 0) {
    console.log(`Input validation failed: ${inputPath}`);
    console.log(`Found ${issues.length} issue(s):`);
    for (const issue of issues) {
      console.log(`  - ${issue}`);
    }
    console.log("Fix domains.txt manually and run validation again.");
    return 1;
  }

  if (domains.length === 0) {
    console.log("No valid domains found.");
    return 1;
  }

  console.log(`Valid: ${inputPath} (${domains.length} domains)`);
  return 0;
}
