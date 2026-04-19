const SNAPSHOT_BASE_URL = import.meta.env.VITE_SNAPSHOT_BASE_URL || 'https://favicon-catalog.github.io/favicons/';

function toSiteUrl(relativePath) {
  return new URL(relativePath, SNAPSHOT_BASE_URL).toString();
}

function folderForDomain(domain) {
  const firstChar = /^[a-z0-9]$/i.test(domain[0] || "") ? domain[0].toLowerCase() : "_";
  return `${firstChar}/${domain}`;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left - right);
}

function iconExtension(file) {
  const parts = String(file || "").split(".");
  return parts.length > 1 ? parts.at(-1).toLowerCase() : "";
}

function buildCatalogEntry(domain, folder, manifest) {
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];

  return {
    domain,
    folder,
    icons: icons.map((icon) => ({
      assetUrl: toSiteUrl(`${folder}/${icon.file}`),
      extension: iconExtension(icon.file) || "file",
      file: icon.file,
      origin: icon.origin || "unknown",
      sizes: uniqueSorted(
        (Array.isArray(icon.sizes) ? icon.sizes : []).filter((size) => Number.isInteger(size) && size > 0),
      ),
    })),
    manifest,
    manifestUrl: toSiteUrl(`${folder}/manifest.json`),
    previewUrl: toSiteUrl(`${folder}/favicon.png`),
  };
}

async function readJson(relativePath) {
  const response = await fetch(toSiteUrl(relativePath), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to load ${relativePath}: ${response.status}`);
  }
  return response.json();
}

export async function loadCatalog() {
  const index = await readJson("index.json");
  const domains = Array.isArray(index.domains) ? index.domains : [];

  const entries = await Promise.all(domains.map(async (domain) => {
    const folder = folderForDomain(domain);
    try {
      const manifest = await readJson(`${folder}/manifest.json`);
      return buildCatalogEntry(domain, folder, manifest);
    } catch (error) {
      console.error(error);
      return {
        domain,
        folder,
        icons: [],
        manifest: null,
        manifestUrl: toSiteUrl(`${folder}/manifest.json`),
        previewUrl: toSiteUrl(`${folder}/favicon.png`),
      };
    }
  }));

  return {
    index,
    entries,
  };
}
