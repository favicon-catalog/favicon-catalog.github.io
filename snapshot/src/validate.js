import { DEFAULT_DOMAINS_FILE } from "./config.js";
import { validateInputFile } from "./download.js";

export async function main(argv = []) {
  if (argv.length > 0) {
    console.log(`Unknown argument: ${argv[0]}`);
    return 1;
  }
  const inputPath = DEFAULT_DOMAINS_FILE;
  let domains;
  let domainIssues;
  try {
    [domains, domainIssues] = await validateInputFile(inputPath);
  } catch {
    console.log(`Input file not found: ${inputPath}`);
    return 1;
  }
  if (domainIssues.length > 0) {
    console.log(`Input validation failed: ${inputPath}`);
    console.log(`Found ${domainIssues.length} issue(s):`);
    for (const issue of domainIssues) {
      console.log(`  - ${issue}`);
    }
    console.log("Fix input/domains.yaml manually and run validation again.");
    return 1;
  }

  if (domains.length === 0) {
    console.log("No valid domains found.");
    return 1;
  }

  console.log(`Valid: ${inputPath} (${domains.length} domains)`);
  return 0;
}
