import { parseArgs } from "node:util";
import { DEFAULT_DOMAINS_FILE } from "./config.js";
import { extractHost, parseDomainConfig } from "./download.js";
import { readSnapshotInputFile, writeSnapshotInputFile } from "./input-file.js";

function normalizeGroup(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("--group must be a non-empty string");
  }
  return value.trim();
}

function isWwwHost(host) {
  return host.split(".")[0] === "www";
}

function isDirectChildDomain(parentDomain, childDomain) {
  return childDomain.endsWith(`.${parentDomain}`)
    && childDomain.split(".").length === parentDomain.split(".").length + 1;
}

function normalizeSubdomains(parentDomain, subdomains) {
  const seen = new Set();
  const normalized = [];

  for (const value of subdomains) {
    const host = extractHost(value ?? "");
    if (!host) {
      throw new Error(`invalid subdomain '${value ?? ""}'`);
    }
    if (isWwwHost(host)) {
      throw new Error(`subdomain '${host}' must not use the 'www' subdomain`);
    }
    if (host === parentDomain || !host.endsWith(`.${parentDomain}`)) {
      throw new Error(`subdomain '${host}' must be within parent domain '${parentDomain}'`);
    }
    if (!isDirectChildDomain(parentDomain, host)) {
      throw new Error(`subdomain '${host}' must be a direct child of parent domain '${parentDomain}'`);
    }
    if (!seen.has(host)) {
      seen.add(host);
      normalized.push(host);
    }
  }

  normalized.sort();
  return normalized;
}

function normalizeExistingSubdomains(parentDomain, subdomains, lineLabel) {
  if (subdomains === undefined) {
    return [];
  }
  if (!Array.isArray(subdomains)) {
    throw new Error(`${lineLabel}: subdomains must be a list`);
  }

  const seen = new Set();
  const normalized = [];

  for (const value of subdomains) {
    const host = extractHost(value ?? "");
    if (!host) {
      throw new Error(`${lineLabel}: invalid subdomain '${value ?? ""}'`);
    }
    if (isWwwHost(host)) {
      throw new Error(`${lineLabel}: subdomain '${host}' must not use the 'www' subdomain`);
    }
    if (host === parentDomain || !host.endsWith(`.${parentDomain}`)) {
      throw new Error(`${lineLabel}: subdomain '${host}' must be within parent domain '${parentDomain}'`);
    }
    if (!isDirectChildDomain(parentDomain, host)) {
      throw new Error(`${lineLabel}: subdomain '${host}' must be a direct child of parent domain '${parentDomain}'`);
    }
    if (seen.has(host)) {
      throw new Error(`${lineLabel}: duplicate domain '${host}'`);
    }
    seen.add(host);
    normalized.push(host);
  }

  normalized.sort();
  return normalized;
}

function normalizeNewEntry(domain, options = {}) {
  const host = extractHost(domain ?? "");
  if (!host) {
    throw new Error(`invalid domain '${domain ?? ""}'`);
  }
  if (isWwwHost(host)) {
    throw new Error(`domain '${host}' must not use the 'www' subdomain`);
  }

  const entry = { name: host };
  const group = normalizeGroup(options.group);
  const subdomains = normalizeSubdomains(host, options.subdomains ?? []);

  if (group !== undefined) {
    entry.group = group;
  }
  if (subdomains.length > 0) {
    entry.subdomains = subdomains;
  }

  return entry;
}

function normalizeExistingConfig(config) {
  if (!Array.isArray(config)) {
    throw new Error("input root must be a list");
  }

  const normalized = config.map((item, index) => {
    const lineLabel = `entry ${index + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${lineLabel}: each entry must be an object`);
    }

    const host = extractHost(item.name ?? "");
    if (!host) {
      throw new Error(`${lineLabel}: invalid domain '${item.name ?? ""}'`);
    }
    if (isWwwHost(host)) {
      throw new Error(`${lineLabel}: domain '${host}' must not use the 'www' subdomain`);
    }

    const entry = { name: host };
    if ("group" in item && item.group !== undefined && item.group !== null) {
      entry.group = normalizeGroup(item.group);
    }

    const subdomains = normalizeExistingSubdomains(host, item.subdomains, lineLabel);
    if (subdomains.length > 0) {
      entry.subdomains = subdomains;
    }

    return entry;
  });

  normalized.sort((left, right) => left.name.localeCompare(right.name));

  const { issues } = parseDomainConfig(normalized);
  if (issues.length > 0) {
    throw new Error(`cannot update invalid input file:\n- ${issues.join("\n- ")}`);
  }

  return normalized;
}

function existingParentHosts(config) {
  return config
    .map((item) => ({ host: extractHost(item?.name ?? "") }))
    .filter((item) => item.host);
}

function existingAllHosts(config) {
  const hosts = new Map();

  config.forEach((item, index) => {
    const parent = extractHost(item?.name ?? "");
    if (!parent) {
      return;
    }

    hosts.set(parent, { kind: "domain", parent, index });
    if (Array.isArray(item.subdomains)) {
      item.subdomains.forEach((value) => {
        const child = extractHost(value ?? "");
        if (child) {
          hosts.set(child, { kind: "subdomain", parent, index });
        }
      });
    }
  });

  return hosts;
}

function findParentEntryIndex(config, domain) {
  let bestIndex = -1;
  let bestParent = null;

  config.forEach((item, index) => {
    const host = extractHost(item?.name ?? "");
    if (!host) {
      return;
    }
    if (domain === host || !domain.endsWith(`.${host}`)) {
      return;
    }
    if (bestParent === null || host.length > bestParent.length) {
      bestParent = host;
      bestIndex = index;
    }
  });

  return bestIndex;
}

function inferredParentDomain(domain) {
  const labels = domain.split(".");
  if (labels.length <= 2) {
    return null;
  }
  const parentLabels = labels.slice(1);
  if (parentLabels.length === 2 && ["co", "or", "go", "ac", "ne", "pe", "re", "com", "org", "net", "edu", "gov", "mil", "ed", "gob", "id"].includes(parentLabels[0])) {
    return null;
  }
  return parentLabels.join(".");
}

export function insertDomainEntry(config, input) {
  const normalizedConfig = normalizeExistingConfig(config);

  const entry = normalizeNewEntry(input.domain, input);
  const existingHosts = existingAllHosts(normalizedConfig);
  const current = existingHosts.get(entry.name);
  if (current) {
    throw new Error(
      current.kind === "domain"
        ? `domain '${entry.name}' already exists`
        : `domain '${entry.name}' already exists as a subdomain under '${current.parent}'`,
    );
  }

  for (const child of entry.subdomains ?? []) {
    const duplicate = existingHosts.get(child);
    if (duplicate) {
      throw new Error(
        duplicate.kind === "domain"
          ? `subdomain '${child}' already exists as a parent domain`
          : `subdomain '${child}' already exists under '${duplicate.parent}'`,
      );
    }
  }

  const updated = [...normalizedConfig];
  const parentEntryIndex = findParentEntryIndex(normalizedConfig, entry.name);

  if (parentEntryIndex !== -1) {
    const parentEntry = updated[parentEntryIndex];
    const nextSubdomains = normalizeSubdomains(parentEntry.name, [
      ...(Array.isArray(parentEntry.subdomains) ? parentEntry.subdomains : []),
      entry.name,
    ]);
    updated[parentEntryIndex] = {
      ...parentEntry,
      subdomains: nextSubdomains,
    };
  } else {
    const parentDomain = inferredParentDomain(entry.name);
    if (parentDomain && !existingHosts.has(parentDomain)) {
      const parentEntry = { name: parentDomain, subdomains: normalizeSubdomains(parentDomain, [entry.name]) };
      if (entry.group !== undefined) {
        parentEntry.group = entry.group;
      }

      const parents = existingParentHosts(updated);
      const insertAt = parents.findIndex((item) => parentEntry.name < item.host);
      updated.splice(insertAt === -1 ? updated.length : insertAt, 0, parentEntry);
    } else {
      const parents = existingParentHosts(updated);
      const insertAt = parents.findIndex((item) => entry.name < item.host);
      updated.splice(insertAt === -1 ? updated.length : insertAt, 0, entry);
    }
  }

  const result = parseDomainConfig(updated);
  if (result.issues.length > 0) {
    throw new Error(`refusing to write invalid config:\n- ${result.issues.join("\n- ")}`);
  }

  return updated;
}

export function parseAddDomainArgs(argv = []) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      group: { type: "string" },
      subdomain: { type: "string", multiple: true, default: [] },
    },
  });

  if (positionals.length !== 1) {
    throw new Error("Usage: collection add-domain <domain> [--group <label>] [--subdomain <host> ...]");
  }

  return {
    domain: positionals[0],
    group: values.group,
    subdomains: values.subdomain,
  };
}

export async function main(argv = []) {
  let args;
  try {
    args = parseAddDomainArgs(argv);
  } catch (error) {
    console.log(error.message);
    return 1;
  }

  const inputPath = DEFAULT_DOMAINS_FILE;
  let snapshotInput;
  try {
    snapshotInput = await readSnapshotInputFile(inputPath);
  } catch (error) {
    console.log(`Failed to read ${inputPath}: ${error.message}`);
    return 1;
  }
  if (snapshotInput.issues.length > 0) {
    console.log(`Cannot update invalid input file: ${inputPath}`);
    for (const issue of snapshotInput.issues) {
      console.log(`  - ${issue}`);
    }
    return 1;
  }

  let updated;
  try {
    updated = insertDomainEntry(snapshotInput.domains, args);
  } catch (error) {
    console.log(error.message);
    return 1;
  }

  try {
    await writeSnapshotInputFile({
      version: snapshotInput.version,
      domains: updated,
    }, inputPath);
  } catch (error) {
    console.log(`Failed to write ${inputPath}: ${error.message}`);
    return 1;
  }

  console.log(`Added ${extractHost(args.domain)} to ${inputPath}`);
  return 0;
}
