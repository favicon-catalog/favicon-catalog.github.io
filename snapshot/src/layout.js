import path from "node:path";

export function domainPrefixDir(outputDir, domain) {
  const firstChar = /^[a-z0-9]$/i.test(domain[0] || "") ? domain[0].toLowerCase() : "_";
  return path.join(outputDir, firstChar);
}

export function targetFolder(outputDir, domain) {
  return path.join(domainPrefixDir(outputDir, domain), domain);
}

export function relativeFolderPath(folder) {
  return folder.split(path.sep).join("/");
}
