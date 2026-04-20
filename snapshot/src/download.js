import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import zlib from "node:zlib";
import YAML from "yaml";
import {
  DEFAULT_DOMAINS_FILE,
  GSTATIC_BASE_URL,
  GSTATIC_SIZES,
  KNOWN_EXTS,
  MANIFEST_FILENAME,
  MANIFEST_VERSION,
  PREFERENCE_ORDER,
  VALID_DISCOVERY_ORIGINS,
} from "./config.js";
import { buildIndexMetadata, writeIndexMetadataFile } from "./index-metadata.js";
import { formatManifestJson, utcTimestamp } from "./json.js";
import { domainPrefixDir, relativeFolderPath, targetFolder } from "./layout.js";
import { resolveOutputPaths } from "./output-paths.js";

const USER_AGENT = "favicon-downloader/4.0";
const DEFAULT_TIMEOUT_MS = 10_000;
const SAMPLE_PARENT_LIMIT = 5;
const DEFAULT_CONCURRENCY = 5;

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) {
    crc = CRC32_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isFile(targetPath) {
  try {
    return (await fs.stat(targetPath)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(targetPath) {
  try {
    return (await fs.stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

function stableJsonKey(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonKey(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const sorted = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJsonKey(value[key])}`);
    return `{${sorted.join(",")}}`;
  }
  return JSON.stringify(value);
}

function printIssueBlock(title, issues) {
  console.log(title);
  for (const issue of issues) {
    console.log(`  - ${issue}`);
  }
}

async function mapLimit(values, limit, mapper) {
  const concurrency = Math.max(1, Math.floor(limit) || 1);
  const results = new Array(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }

  const workerCount = Math.min(concurrency, values.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

export function extractHost(entry) {
  try {
    const parsed = new URL(entry.includes("://") ? entry : `https://${entry}`);
    const host = (parsed.hostname || parsed.pathname.split("/", 1)[0] || "")
      .trim()
      .replace(/^\.+|\.+$/g, "")
      .toLowerCase();
    if (!host) {
      return null;
    }
    const labels = host.split(".");
    if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
      return null;
    }
    return host;
  } catch {
    return null;
  }
}

export function parseDomainConfig(value) {
  const issues = [];
  const duplicates = [];
  const parentOrderingIssues = [];
  const childOrderingIssues = [];
  const domains = [];
  const entries = [];
  const groups = [];
  const groupLabels = new Map();
  const seenDomains = new Set();
  let prevParent = null;

  if (!Array.isArray(value)) {
    return {
      domains,
      entries,
      groups,
      groupLabels,
      issues: ["input root must be a list"],
    };
  }

  function addDomain(host, lineLabel) {
    if (seenDomains.has(host)) {
      duplicates.push(`${lineLabel}: duplicate domain '${host}'`);
      return false;
    }
    seenDomains.add(host);
    domains.push(host);
    return true;
  }

  function isDirectChildDomain(parent, child) {
    return child.endsWith(`.${parent}`) && child.split(".").length === parent.split(".").length + 1;
  }

  function isWwwHost(host) {
    return host.split(".")[0] === "www";
  }

  value.forEach((item, index) => {
    const lineLabel = `entry ${index + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      issues.push(`${lineLabel}: each entry must be an object`);
      return;
    }

    const host = extractHost(item.name ?? "");
    if (!host) {
      issues.push(`${lineLabel}: invalid domain '${item.name ?? ""}'`);
      return;
    }
    if (isWwwHost(host)) {
      issues.push(`${lineLabel}: domain '${host}' must not use the 'www' subdomain`);
      return;
    }

    if (prevParent !== null && host < prevParent) {
      parentOrderingIssues.push(
        `${lineLabel}: parent domains are not in alphabetical order ('${prevParent}' should not come before '${host}')`,
      );
    }
    prevParent = host;

    const entry = { domain: host, group: null, subdomains: [] };
    const domainGroup = { parent: host, subdomains: [] };
    if (!addDomain(host, lineLabel)) {
      return;
    }

    if ("group" in item && item.group !== undefined && item.group !== null) {
      if (typeof item.group !== "string" || item.group.trim() === "") {
        issues.push(`${lineLabel}: group must be a non-empty string`);
      } else {
        entry.group = item.group.trim();
        if (!groupLabels.has(entry.group)) {
          groupLabels.set(entry.group, []);
        }
        groupLabels.get(entry.group).push(host);
      }
    }

    if ("subdomains" in item && item.subdomains !== undefined) {
      if (!Array.isArray(item.subdomains)) {
        issues.push(`${lineLabel}: subdomains must be a list`);
      } else {
        let prevChild = null;
        for (const valueItem of item.subdomains) {
          const child = extractHost(valueItem ?? "");
          if (!child) {
            issues.push(`${lineLabel}: invalid subdomain '${valueItem ?? ""}'`);
            continue;
          }
          if (isWwwHost(child)) {
            issues.push(`${lineLabel}: subdomain '${child}' must not use the 'www' subdomain`);
            continue;
          }
          if (child === host || !child.endsWith(`.${host}`)) {
            issues.push(`${lineLabel}: subdomain '${child}' must be within parent domain '${host}'`);
            continue;
          }
          if (!isDirectChildDomain(host, child)) {
            issues.push(`${lineLabel}: subdomain '${child}' must be a direct child of parent domain '${host}'`);
            continue;
          }
          if (prevChild !== null && child < prevChild) {
            childOrderingIssues.push(
              `${lineLabel}: subdomains for '${host}' are not in alphabetical order ('${prevChild}' should not come before '${child}')`,
            );
          }
          prevChild = child;
          if (addDomain(child, lineLabel)) {
            entry.subdomains.push(child);
            domainGroup.subdomains.push(child);
          }
        }
      }
    }

    entries.push(entry);
    groups.push(domainGroup);
  });

  return {
    domains,
    entries,
    groups,
    groupLabels,
    issues: [...issues, ...duplicates, ...parentOrderingIssues, ...childOrderingIssues],
  };
}

export async function validateInputFile(inputPath = DEFAULT_DOMAINS_FILE) {
  const text = await fs.readFile(inputPath, "utf8");
  const parsed = YAML.parse(text);
  const result = parseDomainConfig(parsed);
  return [result.domains, result.issues, result];
}

async function readInputDomainTree(inputPath) {
  const text = await fs.readFile(inputPath, "utf8");
  const parsed = YAML.parse(text);
  return parseDomainConfig(parsed);
}

function normalizeRel(value) {
  return value.toLowerCase().trim().split(/\s+/).filter(Boolean).join(" ");
}

function normalizeSizes(value) {
  return value.toLowerCase().trim().split(/\s+/).filter(Boolean).join(" ");
}

function normalizeMime(value) {
  return value.split(";", 1)[0].trim().toLowerCase();
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function folderManifestPath(folder) {
  return path.join(folder, MANIFEST_FILENAME);
}

async function deleteDomainFolder(folder) {
  if (await pathExists(folder)) {
    await fs.rm(folder, { recursive: true, force: true });
  }
}

async function cleanupFlatFiles(outputDir, domain) {
  const prefixDir = domainPrefixDir(outputDir, domain);
  if (!(await isDirectory(prefixDir))) {
    return;
  }

  const primaryNames = new Set(KNOWN_EXTS.map((ext) => `${domain}${ext}`));
  for (const name of await fs.readdir(prefixDir)) {
    const candidate = path.join(prefixDir, name);
    if (!(await isFile(candidate))) {
      continue;
    }
    if (primaryNames.has(name) || name.startsWith(`${domain}--`)) {
      await fs.unlink(candidate);
    }
  }
}

function fetchWithTimeout(url) {
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    redirect: "follow",
  });
}

async function fetchBytes(url) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("empty response body");
  }
  return [buffer, response.headers.get("content-type")];
}

async function fetchHtml(url) {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const contentType = normalizeMime(response.headers.get("content-type") || "");
  if (!contentType.includes("html")) {
    return "";
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString("utf8");
}

function parseLinkTagAttributes(tagText) {
  const attrs = {};
  const attrRegex = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of tagText.matchAll(attrRegex)) {
    const key = match[1]?.toLowerCase();
    if (!key || key === "link") {
      continue;
    }
    attrs[key] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
}

function parseIconLinks(html) {
  const links = [];
  const tagRegex = /<link\b[^>]*>/gi;
  for (const match of html.matchAll(tagRegex)) {
    const attrs = parseLinkTagAttributes(match[0]);
    const rel = normalizeRel(attrs.rel || "");
    const href = (attrs.href || "").trim();
    if (href && rel.includes("icon")) {
      links.push({
        url: href,
        rel,
        sizes: normalizeSizes(attrs.sizes || ""),
        declaredType: normalizeMime(attrs.type || ""),
        source: "html",
      });
    }
  }
  return links;
}

async function resolveIconLinks(baseUrl) {
  const html = await fetchHtml(baseUrl);
  if (!html) {
    return [];
  }

  const resolved = [];
  const seen = new Set();
  for (const link of parseIconLinks(html)) {
    let absoluteUrl;
    try {
      absoluteUrl = new URL(link.url, `${baseUrl}/`).href;
    } catch {
      continue;
    }
    const dedupeKey = [absoluteUrl, link.rel, link.sizes, link.declaredType, link.source].join("\n");
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    resolved.push({
      url: absoluteUrl,
      rel: link.rel,
      sizes: link.sizes,
      declaredType: link.declaredType,
      source: link.source,
    });
  }
  return resolved;
}

function fallbackIconLinks(baseUrl) {
  return [
    {
      url: new URL("favicon.ico", `${baseUrl}/`).href,
      rel: "root",
      declaredType: "image/x-icon",
      source: "root",
    },
    {
      url: new URL("favicon.svg", `${baseUrl}/`).href,
      rel: "root",
      declaredType: "image/svg+xml",
      source: "root",
    },
    {
      url: new URL("favicon.png", `${baseUrl}/`).href,
      rel: "root",
      declaredType: "image/png",
      source: "root",
    },
  ];
}

function gstaticIconLinks(domain) {
  return GSTATIC_SIZES.map((size) => {
    const params = new URLSearchParams({
      client: "SOCIAL",
      type: "FAVICON",
      fallback_opts: "TYPE,SIZE,URL",
      url: `https://${domain}`,
      size: String(size),
    });
    return {
      url: `${GSTATIC_BASE_URL}?${params.toString()}`,
      rel: "gstatic",
      declaredType: "image/png",
      source: "gstatic",
    };
  });
}

function dedupeLinkKey(link) {
  return [link.url, link.rel, link.sizes, link.declaredType, link.source].join("\n");
}

async function candidateIconLinks(baseUrl, domain, errors) {
  const links = [];
  const seen = new Set();

  try {
    for (const link of await resolveIconLinks(baseUrl)) {
      const key = dedupeLinkKey(link);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      links.push(link);
    }
  } catch (error) {
    errors.push(`${baseUrl}: ${error.message}`);
  }

  const seenUrls = new Set(links.map((link) => link.url));
  for (const link of fallbackIconLinks(baseUrl)) {
    const key = dedupeLinkKey(link);
    if (seen.has(key) || seenUrls.has(link.url)) {
      continue;
    }
    seen.add(key);
    seenUrls.add(link.url);
    links.push(link);
  }

  for (const link of gstaticIconLinks(domain)) {
    const key = dedupeLinkKey(link);
    if (seen.has(key) || seenUrls.has(link.url)) {
      continue;
    }
    seen.add(key);
    seenUrls.add(link.url);
    links.push(link);
  }
  return links;
}

function aggregateIconLinks(links) {
  const grouped = new Map();
  const seenLinkKeys = new Map();

  links.forEach((link, order) => {
    if (!grouped.has(link.url)) {
      grouped.set(link.url, { url: link.url, order, links: [] });
      seenLinkKeys.set(link.url, new Set());
    }
    const linkKey = [link.rel, link.sizes, link.declaredType, link.source].join("\n");
    if (seenLinkKeys.get(link.url).has(linkKey)) {
      return;
    }
    seenLinkKeys.get(link.url).add(linkKey);
    grouped.get(link.url).links.push(link);
  });

  return [...grouped.values()].sort((left, right) => left.order - right.order);
}

function toBaseUrls(domain) {
  return [`https://${domain}`];
}

function isIcoBytes(data) {
  return data.length >= 4
    && (data.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))
      || data.subarray(0, 4).equals(Buffer.from([0, 0, 2, 0])));
}

function looksLikeSvg(data) {
  return data.subarray(0, 2048).toString("utf8").toLowerCase().includes("<svg");
}

function detectImageExtension(data, contentType) {
  if (isIcoBytes(data)) {
    return ".ico";
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return ".png";
  }
  if (data.length >= 6 && ["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))) {
    return ".gif";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return ".jpg";
  }
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return ".webp";
  }
  if (data.length >= 2 && data.subarray(0, 2).toString("ascii") === "BM") {
    return ".bmp";
  }
  if (looksLikeSvg(data)) {
    return ".svg";
  }

  const mime = normalizeMime(contentType || "");
  if (mime === "image/svg+xml") {
    return ".svg";
  }
  return null;
}

function parseSvgLength(value) {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)/.exec(value);
  if (!match) {
    return null;
  }
  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function parseSvgMetadata(data) {
  const text = data.subarray(0, 8192).toString("utf8");
  const widthMatch = /\bwidth\s*=\s*"([^"]+)"/i.exec(text);
  const heightMatch = /\bheight\s*=\s*"([^"]+)"/i.exec(text);
  const viewboxMatch = /\bviewBox\s*=\s*"([^"]+)"/i.exec(text);

  let width = widthMatch ? parseSvgLength(widthMatch[1]) : null;
  let height = heightMatch ? parseSvgLength(heightMatch[1]) : null;
  const viewBox = viewboxMatch ? viewboxMatch[1].trim() : null;

  if ((width === null || height === null) && viewBox) {
    const parts = viewBox.replaceAll(",", " ").trim().split(/\s+/);
    if (parts.length === 4) {
      const widthCandidate = Number.parseFloat(parts[2]);
      const heightCandidate = Number.parseFloat(parts[3]);
      if (width === null && Number.isFinite(widthCandidate)) {
        width = Math.trunc(widthCandidate);
      }
      if (height === null && Number.isFinite(heightCandidate)) {
        height = Math.trunc(heightCandidate);
      }
    }
  }

  return [width, height];
}

function pngDimensions(data) {
  if (data.length < 24) {
    return [null, null];
  }
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

function gifDimensions(data) {
  if (data.length < 10) {
    return [null, null];
  }
  return [data.readUInt16LE(6), data.readUInt16LE(8)];
}

function bmpDimensions(data) {
  if (data.length < 26) {
    return [null, null];
  }
  return [Math.abs(data.readInt32LE(18)), Math.abs(data.readInt32LE(22))];
}

function icoDimensions(data) {
  if (data.length < 6) {
    return [null, null];
  }
  const count = data.readUInt16LE(4);
  if (count <= 0 || data.length < 6 + count * 16) {
    return [null, null];
  }
  let maxWidth = 0;
  let maxHeight = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = data[offset] || 256;
    const height = data[offset + 1] || 256;
    maxWidth = Math.max(maxWidth, width);
    maxHeight = Math.max(maxHeight, height);
  }
  return [maxWidth || null, maxHeight || null];
}

function icoSizes(data) {
  if (data.length < 6) {
    return [];
  }
  const count = data.readUInt16LE(4);
  if (count <= 0 || data.length < 6 + count * 16) {
    return [];
  }
  const sizes = new Set();
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = data[offset] || 256;
    const height = data[offset + 1] || 256;
    if (width === height) {
      sizes.add(width);
    }
  }
  return [...sizes].sort((left, right) => left - right);
}

function iterIcoFrames(data) {
  if (data.length < 6) {
    return [];
  }
  const count = data.readUInt16LE(4);
  if (count <= 0 || data.length < 6 + count * 16) {
    return [];
  }

  const frames = [];
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16;
    const width = data[offset] || 256;
    const height = data[offset + 1] || 256;
    if (width !== height) {
      continue;
    }
    const bitCount = data.readUInt16LE(offset + 6);
    const blobSize = data.readUInt32LE(offset + 8);
    const blobOffset = data.readUInt32LE(offset + 12);
    if (blobSize <= 0 || blobOffset + blobSize > data.length) {
      continue;
    }
    const blob = data.subarray(blobOffset, blobOffset + blobSize);
    frames.push({
      size: width,
      bitCount,
      blob,
      isPng: blob.length >= 8 && blob.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    });
  }
  return frames;
}

function pngChunk(chunkType, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([chunkType, payload])), 0);
  return Buffer.concat([length, chunkType, payload, crc]);
}

function rgbaPngBytes(width, height, rgba) {
  const stride = width * 4;
  const rows = [];
  for (let row = 0; row < height; row += 1) {
    const start = row * stride;
    rows.push(Buffer.from([0]));
    rows.push(rgba.subarray(start, start + stride));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk(Buffer.from("IHDR"), ihdr),
    pngChunk(Buffer.from("IDAT"), zlib.deflateSync(Buffer.concat(rows))),
    pngChunk(Buffer.from("IEND"), Buffer.alloc(0)),
  ]);
}

function andMaskStride(width) {
  return Math.trunc((width + 31) / 32) * 4;
}

function bitmapStride(width, bitCount) {
  return Math.trunc((width * bitCount + 31) / 32) * 4;
}

function applyIcoAndMask(rgba, mask, width, height) {
  const stride = andMaskStride(width);
  if (mask.length < stride * height) {
    return;
  }
  for (let row = 0; row < height; row += 1) {
    const sourceRow = height - 1 - row;
    const rowStart = sourceRow * stride;
    for (let column = 0; column < width; column += 1) {
      const byteIndex = rowStart + Math.trunc(column / 8);
      const bit = 7 - (column % 8);
      if (mask[byteIndex] & (1 << bit)) {
        rgba[(row * width + column) * 4 + 3] = 0;
      }
    }
  }
}

function decodeIcoBmpFrame(frame) {
  const blob = frame.blob;
  if (blob.length < 40) {
    return null;
  }
  const headerSize = blob.readUInt32LE(0);
  if (headerSize < 40 || blob.length < headerSize) {
    return null;
  }

  const width = Math.abs(blob.readInt32LE(4));
  const dibHeight = Math.abs(blob.readInt32LE(8));
  const bitCount = blob.readUInt16LE(14);
  const compression = blob.readUInt32LE(16);
  const colorsUsed = blob.readUInt32LE(32);
  if (compression !== 0 || width !== frame.size || dibHeight < frame.size) {
    return null;
  }
  if (![4, 8, 24, 32].includes(bitCount)) {
    return null;
  }

  let paletteEntries = 0;
  if (bitCount <= 8) {
    paletteEntries = colorsUsed || (1 << bitCount);
  }
  const paletteOffset = headerSize;
  const xorOffset = paletteOffset + paletteEntries * 4;
  const xorStride = bitmapStride(frame.size, bitCount);
  const xorSize = xorStride * frame.size;
  if (blob.length < xorOffset + xorSize) {
    return null;
  }
  const xorBitmap = blob.subarray(xorOffset, xorOffset + xorSize);
  const andOffset = xorOffset + xorSize;
  const andBitmap = blob.subarray(andOffset, andOffset + andMaskStride(frame.size) * frame.size);

  const palette = [];
  for (let index = 0; index < paletteEntries; index += 1) {
    const entryOffset = paletteOffset + index * 4;
    if (entryOffset + 4 > blob.length) {
      return null;
    }
    const blue = blob[entryOffset];
    const green = blob[entryOffset + 1];
    const red = blob[entryOffset + 2];
    const alpha = blob[entryOffset + 3];
    palette.push([red, green, blue, alpha]);
  }

  const rgba = Buffer.alloc(frame.size * frame.size * 4);
  let sawAlpha = false;

  for (let row = 0; row < frame.size; row += 1) {
    const sourceRow = frame.size - 1 - row;
    const rowStart = sourceRow * xorStride;
    for (let column = 0; column < frame.size; column += 1) {
      const pixelOffset = (row * frame.size + column) * 4;
      if (bitCount === 32) {
        const source = rowStart + column * 4;
        if (source + 4 > xorBitmap.length) {
          return null;
        }
        const blue = xorBitmap[source];
        const green = xorBitmap[source + 1];
        const red = xorBitmap[source + 2];
        const alpha = xorBitmap[source + 3];
        rgba[pixelOffset] = red;
        rgba[pixelOffset + 1] = green;
        rgba[pixelOffset + 2] = blue;
        rgba[pixelOffset + 3] = alpha;
        sawAlpha ||= alpha > 0;
        continue;
      }

      if (bitCount === 24) {
        const source = rowStart + column * 3;
        if (source + 3 > xorBitmap.length) {
          return null;
        }
        const blue = xorBitmap[source];
        const green = xorBitmap[source + 1];
        const red = xorBitmap[source + 2];
        rgba[pixelOffset] = red;
        rgba[pixelOffset + 1] = green;
        rgba[pixelOffset + 2] = blue;
        rgba[pixelOffset + 3] = 255;
        continue;
      }

      let paletteIndex;
      if (bitCount === 8) {
        const source = rowStart + column;
        if (source >= xorBitmap.length) {
          return null;
        }
        paletteIndex = xorBitmap[source];
      } else {
        const source = rowStart + Math.trunc(column / 2);
        if (source >= xorBitmap.length) {
          return null;
        }
        const value = xorBitmap[source];
        paletteIndex = column % 2 === 0 ? (value >> 4) : (value & 0x0f);
      }

      if (paletteIndex >= palette.length) {
        return null;
      }
      const [red, green, blue, alpha] = palette[paletteIndex];
      rgba[pixelOffset] = red;
      rgba[pixelOffset + 1] = green;
      rgba[pixelOffset + 2] = blue;
      rgba[pixelOffset + 3] = alpha || 255;
    }
  }

  if (bitCount === 32 && !sawAlpha) {
    for (let offset = 3; offset < rgba.length; offset += 4) {
      rgba[offset] = 255;
    }
  }
  applyIcoAndMask(rgba, andBitmap, frame.size, frame.size);
  return rgbaPngBytes(frame.size, frame.size, rgba);
}

function extractIcoPngAssets(asset) {
  if (asset.ext !== ".ico") {
    return [];
  }
  const bestFrames = new Map();
  for (const frame of iterIcoFrames(asset.data)) {
    const existing = bestFrames.get(frame.size);
    const candidateKey = [frame.isPng ? 1 : 0, frame.bitCount, frame.blob.length];
    if (!existing) {
      bestFrames.set(frame.size, frame);
      continue;
    }
    const existingKey = [existing.isPng ? 1 : 0, existing.bitCount, existing.blob.length];
    if (compareTuple(candidateKey, existingKey) > 0) {
      bestFrames.set(frame.size, frame);
    }
  }

  const extracted = [];
  for (const size of [...bestFrames.keys()].sort((left, right) => left - right)) {
    const frame = bestFrames.get(size);
    const pngData = frame.isPng ? frame.blob : decodeIcoBmpFrame(frame);
    if (!pngData) {
      continue;
    }
    extracted.push({
      url: asset.url,
      ext: ".png",
      data: pngData,
      sizes: [size],
      links: asset.links.map((link) => ({ ...link })),
      order: asset.order,
      derivedFromIco: true,
      file: "",
    });
  }
  return extracted;
}

function jpegDimensions(data) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return [null, null];
  }
  let position = 2;
  while (position + 9 < data.length) {
    if (data[position] !== 0xff) {
      position += 1;
      continue;
    }
    const marker = data[position + 1];
    position += 2;
    if (marker === 0xd8 || marker === 0xd9) {
      continue;
    }
    if (position + 2 > data.length) {
      break;
    }
    const segmentLength = data.readUInt16BE(position);
    if (segmentLength < 2 || position + segmentLength > data.length) {
      break;
    }
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (segmentLength >= 7) {
        return [data.readUInt16BE(position + 5), data.readUInt16BE(position + 3)];
      }
      break;
    }
    position += segmentLength;
  }
  return [null, null];
}

function webpDimensions(data) {
  if (data.length < 30 || data.subarray(0, 4).toString("ascii") !== "RIFF" || data.subarray(8, 12).toString("ascii") !== "WEBP") {
    return [null, null];
  }
  const chunk = data.subarray(12, 16).toString("ascii");
  if (chunk === "VP8X" && data.length >= 30) {
    const width = 1 + data.readUIntLE(24, 3);
    const height = 1 + data.readUIntLE(27, 3);
    return [width, height];
  }
  if (chunk === "VP8 " && data.length >= 30) {
    if (data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a) {
      return [data.readUInt16LE(26) & 0x3fff, data.readUInt16LE(28) & 0x3fff];
    }
  }
  if (chunk === "VP8L" && data.length >= 25) {
    const bits = data.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  return [null, null];
}

function imageMetadata(data, ext) {
  switch (ext) {
    case ".svg":
      return parseSvgMetadata(data);
    case ".png":
      return pngDimensions(data);
    case ".gif":
      return gifDimensions(data);
    case ".bmp":
      return bmpDimensions(data);
    case ".ico":
      return icoDimensions(data);
    case ".jpg":
      return jpegDimensions(data);
    case ".webp":
      return webpDimensions(data);
    default:
      return [null, null];
  }
}

function actualSizes(data, ext) {
  if (ext === ".ico") {
    const sizes = icoSizes(data);
    return sizes.length > 0 ? sizes : null;
  }
  const [width, height] = imageMetadata(data, ext);
  if (ext === ".svg") {
    if (width === null || height === null) {
      return [];
    }
    return width === height ? [width] : null;
  }
  if (width === null || height === null || width !== height) {
    return null;
  }
  return [width];
}

function buildDiscoveryPayload(link, resolvedUrl) {
  return { origin: link.source, url: resolvedUrl };
}

function isIgnorableGstatic404(candidate, error) {
  const origins = (candidate.links || []).map((link) => link.source);
  const isGstaticOnly = origins.length > 0 && origins.every((origin) => origin === "gstatic");
  return isGstaticOnly && String(error?.message || "").startsWith("HTTP 404");
}

async function downloadIconAssets(domain) {
  const errors = [];
  const downloaded = [];
  const seenUrls = new Set();

  for (const baseUrl of toBaseUrls(domain)) {
    const candidates = aggregateIconLinks(await candidateIconLinks(baseUrl, domain, errors));
    for (const candidate of candidates) {
      if (seenUrls.has(candidate.url)) {
        continue;
      }
      seenUrls.add(candidate.url);
      try {
        const [data, contentType] = await fetchBytes(candidate.url);
        const ext = detectImageExtension(data, contentType);
        if (!KNOWN_EXTS.includes(ext)) {
          continue;
        }
        const sizes = actualSizes(data, ext);
        if (sizes === null) {
          continue;
        }
        const asset = {
          url: candidate.url,
          ext,
          data,
          sizes,
          links: candidate.links.map((link) => buildDiscoveryPayload(link, candidate.url)),
          order: candidate.order,
          derivedFromIco: false,
          file: "",
        };
        downloaded.push(asset, ...extractIcoPngAssets(asset));
      } catch (error) {
        if (isIgnorableGstatic404(candidate, error)) {
          continue;
        }
        errors.push(`${candidate.url}: ${error.message}`);
      }
    }
  }

  if (downloaded.length === 0) {
    console.log(`[fail] ${domain}`);
    for (const error of errors.slice(-5)) {
      console.log(`  - ${error}`);
    }
    return null;
  }
  return dedupeAssetsByContent(downloaded);
}

function preferredPrefix(asset) {
  const primary = asset.links.length > 0 ? orderedSources(asset)[0] : { origin: "" };
  return primary.origin === "gstatic" ? "gstatic" : "favicon";
}

function preferredFilename(domain, asset) {
  const prefix = preferredPrefix(asset);
  const baseName = `${domain}-${prefix}`;
  if (asset.ext === ".svg") {
    return `${baseName}.svg`;
  }
  if (asset.ext === ".ico") {
    return `${baseName}.ico`;
  }
  if (asset.sizes.length > 0) {
    const size = Math.max(...asset.sizes);
    if (asset.derivedFromIco) {
      return `${baseName}.ico.${size}${asset.ext}`;
    }
    return `${baseName}.${size}${asset.ext}`;
  }
  return `${baseName}${asset.ext}`;
}

function filenameWithToken(filename, token) {
  const extension = path.extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  return `${stem}.${token}${extension}`;
}

function mergeDiscoveries(existing, next) {
  const merged = [];
  const seen = new Set();
  for (const item of [...existing, ...next]) {
    const key = stableJsonKey(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function dedupeAssetsByContent(assets) {
  const deduped = [];
  const byHash = new Map();
  const sorted = [...assets].sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.url.localeCompare(right.url);
  });
  for (const asset of sorted) {
    const contentHash = sha256Hex(asset.data);
    const existing = byHash.get(contentHash);
    if (!existing) {
      byHash.set(contentHash, asset);
      deduped.push(asset);
      continue;
    }
    existing.links = mergeDiscoveries(existing.links, asset.links);
  }
  return deduped;
}

function originRank(origin) {
  const index = PREFERENCE_ORDER.indexOf(origin);
  return index === -1 ? PREFERENCE_ORDER.length : index;
}

function urlMatchesAssetExt(url, ext) {
  if (!url) {
    return true;
  }
  try {
    return path.extname(new URL(url).pathname).toLowerCase() === ext;
  } catch {
    return false;
  }
}

function orderedSources(asset) {
  return asset.links
    .map((link, index) => ({ link, index }))
    .sort((left, right) => {
      const leftRank = originRank(left.link.origin || "");
      const rightRank = originRank(right.link.origin || "");
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      const leftMatch = urlMatchesAssetExt(left.link.url || "", asset.ext) ? 0 : 1;
      const rightMatch = urlMatchesAssetExt(right.link.url || "", asset.ext) ? 0 : 1;
      if (leftMatch !== rightMatch) {
        return leftMatch - rightMatch;
      }
      if (left.index !== right.index) {
        return left.index - right.index;
      }
      return (left.link.url || "").localeCompare(right.link.url || "");
    })
    .map((item) => item.link);
}

function buildIconPayload(asset) {
  const sources = mergeDiscoveries([], orderedSources(asset));
  const primary = sources[0] || { origin: "", url: asset.url };
  const payload = {
    file: asset.file,
    origin: primary.origin || "",
    url: primary.url || "",
    sizes: asset.sizes,
  };
  const aliases = sources.slice(1);
  if (aliases.length > 0) {
    payload.aliases = aliases;
  }
  return payload;
}

function assetSortKey(asset) {
  const primary = asset.links.length > 0 ? orderedSources(asset)[0] : { origin: "" };
  const maxSize = asset.sizes.length > 0 ? Math.max(...asset.sizes) : -1;
  return [
    originRank(primary.origin || ""),
    -maxSize,
    asset.file.toLowerCase(),
    asset.sizes.length,
    asset.url,
  ];
}

function compareSortKeys(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] < right[index]) {
      return -1;
    }
    if (left[index] > right[index]) {
      return 1;
    }
  }
  return 0;
}

function compareTuple(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue < rightValue) {
      return -1;
    }
    if (leftValue > rightValue) {
      return 1;
    }
  }
  return 0;
}

function representativePngSortKey(asset) {
  const primary = asset.links.length > 0 ? orderedSources(asset)[0] : { origin: "" };
  const maxSize = asset.sizes.length > 0 ? Math.max(...asset.sizes) : -1;
  return [
    originRank(primary.origin || ""),
    asset.derivedFromIco ? 1 : 0,
    -maxSize,
    asset.file.toLowerCase(),
    asset.url,
  ];
}

function selectRepresentativePng(assets) {
  const pngAssets = assets.filter((asset) => asset.ext === ".png");
  if (pngAssets.length === 0) {
    return null;
  }

  const largePngAssets = pngAssets.filter((asset) => {
    const maxSize = asset.sizes.length > 0 ? Math.max(...asset.sizes) : -1;
    return maxSize >= 48;
  });
  const candidates = largePngAssets.length > 0 ? largePngAssets : pngAssets;

  return [...candidates].sort((left, right) => compareSortKeys(
    representativePngSortKey(left),
    representativePngSortKey(right),
  ))[0];
}

function assignAssetFilenames(domain, assets) {
  const usedNames = new Set();
  for (const asset of assets) {
    let candidate = preferredFilename(domain, asset);
    if (usedNames.has(candidate)) {
      const token = sha256Hex(Buffer.from(asset.url, "utf8")).slice(0, 8);
      candidate = filenameWithToken(candidate, token);
    }
    while (usedNames.has(candidate)) {
      const token = sha256Hex(Buffer.from(asset.url + candidate, "utf8")).slice(0, 10);
      candidate = filenameWithToken(preferredFilename(domain, asset), token);
    }
    usedNames.add(candidate);
    asset.file = candidate;
  }
}

async function writeBytesIfChanged(targetPath, data) {
  try {
    const existing = await fs.readFile(targetPath);
    if (existing.length === data.length && existing.equals(data)) {
      return;
    }
  } catch {}
  await fs.writeFile(targetPath, data);
}

function buildFolderManifest(domain, assets) {
  const icons = [...assets]
    .sort((left, right) => compareSortKeys(assetSortKey(left), assetSortKey(right)))
    .map((asset) => buildIconPayload(asset));
  return {
    manifest_version: MANIFEST_VERSION,
    updated_at: utcTimestamp(),
    domain,
    icons,
  };
}

async function writeFolderManifest(folder, domain, assets) {
  const manifest = buildFolderManifest(domain, assets);
  await fs.writeFile(folderManifestPath(folder), `${formatManifestJson(manifest)}\n`, "utf8");
}

async function writeRepresentativePng(folder, domain, assets) {
  const representative = selectRepresentativePng(assets);
  if (!representative) {
    return;
  }
  await writeBytesIfChanged(path.join(folder, "favicon.png"), representative.data);
}

async function saveDomainAssets(domain, assets, outputDir) {
  const folder = targetFolder(outputDir, domain);
  await cleanupFlatFiles(outputDir, domain);
  await deleteDomainFolder(folder);
  await fs.mkdir(folder, { recursive: true });
  for (const asset of assets) {
    await writeBytesIfChanged(path.join(folder, asset.file), asset.data);
  }
  await writeRepresentativePng(folder, domain, assets);
  await writeFolderManifest(folder, domain, assets);
  return folder;
}

async function restoreDomainAssets(domain, outputDir, fallbackIconsDir) {
  if (!fallbackIconsDir) {
    return null;
  }
  const [sourceFolder, manifest] = await inspectDomainFolder(domain, fallbackIconsDir);
  if (!sourceFolder || !manifest) {
    return null;
  }

  const folder = targetFolder(outputDir, domain);
  await cleanupFlatFiles(outputDir, domain);
  await deleteDomainFolder(folder);
  await fs.mkdir(path.dirname(folder), { recursive: true });
  await fs.cp(sourceFolder, folder, { recursive: true });
  return folder;
}

export async function loadFolderManifest(folder, domain) {
  const manifestPath = folderManifestPath(folder);
  if (!(await pathExists(manifestPath))) {
    throw new Error("missing manifest.json");
  }

  let payload;
  try {
    payload = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`invalid manifest.json: ${error.message}`);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("manifest root must be an object");
  }
  const manifestVersion = payload.manifest_version ?? 0;
  if (!Number.isInteger(manifestVersion)) {
    throw new Error("manifest_version must be an integer");
  }
  if (manifestVersion !== MANIFEST_VERSION) {
    throw new Error(`unsupported manifest_version ${manifestVersion}; expected ${MANIFEST_VERSION}`);
  }
  if (typeof payload.updated_at !== "string" || !payload.updated_at) {
    throw new Error("manifest updated_at must be a non-empty string");
  }
  if (payload.domain !== domain) {
    throw new Error("manifest domain does not match folder domain");
  }
  if (!Array.isArray(payload.icons) || payload.icons.length === 0) {
    throw new Error("manifest icons must be a non-empty list");
  }

  const seenFiles = new Set();
  const normalizedIcons = [];
  for (const icon of payload.icons) {
    if (!icon || typeof icon !== "object" || Array.isArray(icon)) {
      throw new Error("each icon entry must be an object");
    }
    const { file, origin, url, sizes, aliases } = icon;
    if (typeof file !== "string" || file.length === 0) {
      throw new Error("icon file must be a non-empty string");
    }
    if (file.includes("/") || file.includes("\\")) {
      throw new Error("icon file must be local to the folder");
    }
    if (typeof origin !== "string" || !VALID_DISCOVERY_ORIGINS.has(origin)) {
      throw new Error("icon origin must be a known origin value");
    }
    if (typeof url !== "string") {
      throw new Error("icon url must be a string");
    }
    if (!Array.isArray(sizes) || !sizes.every((size) => Number.isInteger(size) && size > 0)) {
      throw new Error("icon sizes must be a list of positive integers");
    }
    if (aliases !== undefined && !Array.isArray(aliases)) {
      throw new Error("icon aliases must be a list when present");
    }
    for (const alias of aliases || []) {
      if (!alias || typeof alias !== "object" || Array.isArray(alias)) {
        throw new Error("each alias entry must be an object");
      }
      if (typeof alias.origin !== "string" || !VALID_DISCOVERY_ORIGINS.has(alias.origin)) {
        throw new Error("each alias entry must include a known origin value");
      }
      if (alias.url !== undefined && typeof alias.url !== "string") {
        throw new Error("each alias url must be a string when present");
      }
    }
    if (seenFiles.has(file)) {
      throw new Error("icon file names must be unique");
    }
    seenFiles.add(file);
    if (!(await isFile(path.join(folder, file)))) {
      throw new Error(`missing icon file referenced by manifest: ${file}`);
    }
    normalizedIcons.push(icon);
  }

  return {
    manifest_version: manifestVersion,
    updated_at: payload.updated_at,
    domain,
    icons: normalizedIcons,
  };
}

export async function inspectDomainFolder(domain, outputDir) {
  const folder = targetFolder(outputDir, domain);
  if (!(await pathExists(folder))) {
    return [null, null, null];
  }
  try {
    const manifest = await loadFolderManifest(folder, domain);
    return [folder, manifest, null];
  } catch (error) {
    if (error.message === "missing manifest.json") {
      return [folder, null, "missing manifest.json"];
    }
    return [folder, null, error.message];
  }
}

async function reusableDomainState(domain, outputDir) {
  const [folder, manifest, issue] = await inspectDomainFolder(domain, outputDir);
  if (manifest) {
    return [folder, manifest];
  }
  if (folder && issue) {
    if (issue === "missing manifest.json") {
      console.log(`[reset] ${domain} -> missing manifest.json in ${folder}`);
    } else {
      console.log(`[reset] ${domain} -> ${issue}`);
    }
    await deleteDomainFolder(folder);
  }
  return [null, null];
}

function parseRequestedDomains(requested, availableDomains, groups) {
  if (requested.length === 0) {
    return [availableDomains, []];
  }

  const availableSet = new Set(availableDomains);
  const groupMembers = new Map(groups.map((group) => [group.parent, [group.parent, ...group.subdomains]]));
  const selected = [];
  const seen = new Set();
  const issues = [];
  for (const value of requested) {
    const host = extractHost(value);
    if (!host) {
      issues.push(`invalid --domain value '${value}'`);
      continue;
    }
    if (!availableSet.has(host)) {
      issues.push(`requested domain '${host}' is not present in the input file`);
      continue;
    }
    if (seen.has(host)) {
      continue;
    }
    const members = groupMembers.get(host) || [host];
    for (const member of members) {
      if (seen.has(member)) {
        continue;
      }
      seen.add(member);
      selected.push(member);
    }
  }
  return [selected, issues];
}

function parseDownloadArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      concurrency: { type: "string" },
      domain: { type: "string", multiple: true, default: [] },
      "fallback-root": { type: "string" },
      sample: { type: "boolean", default: false },
    },
  });
  const parsedConcurrency = values.concurrency === undefined ? DEFAULT_CONCURRENCY : Number.parseInt(values.concurrency, 10);
  return {
    concurrency: Number.isInteger(parsedConcurrency) && parsedConcurrency > 0 ? parsedConcurrency : null,
    domain: values.domain,
    fallbackRoot: values["fallback-root"],
    sample: values.sample,
  };
}

export async function main(argv = []) {
  const args = parseDownloadArgs(argv);
  const inputPath = DEFAULT_DOMAINS_FILE;
  const fallbackIconsDir = args.fallbackRoot ? args.fallbackRoot : null;
  if (args.concurrency === null) {
    console.log(`--concurrency must be a positive integer (default: ${DEFAULT_CONCURRENCY})`);
    return 1;
  }
  if (!(await pathExists(inputPath))) {
    console.log(`Input file not found: ${inputPath}`);
    return 1;
  }

  const { domains, groups, issues } = await readInputDomainTree(inputPath);
  if (issues.length > 0) {
    printIssueBlock("Input validation failed:", issues);
    return 1;
  }
  if (domains.length === 0) {
    console.log("No valid domains found.");
    return 1;
  }

  if (args.sample && args.domain.length > 0) {
    console.log("Do not combine --sample with explicit --domain values.");
    return 1;
  }

  const sampleDomains = groups
    .slice(0, SAMPLE_PARENT_LIMIT)
    .flatMap((group) => [group.parent, ...group.subdomains]);
  const [targetDomains, targetIssues] = args.sample
    ? [sampleDomains, []]
    : parseRequestedDomains(args.domain, domains, groups);
  if (targetIssues.length > 0) {
    printIssueBlock("Domain selection failed:", targetIssues);
    return 1;
  }

  const {
    releaseVersion,
    outputRoot,
    iconsDir,
    indexPath,
  } = await resolveOutputPaths();

  await fs.rm(outputRoot, { recursive: true, force: true });
  await fs.mkdir(iconsDir, { recursive: true });

  let downloaded = 0;
  let restored = 0;
  const indexedDomains = [];
  const failedDomains = [];

  const domainResults = await mapLimit(targetDomains, args.concurrency, async (domain) => {
    const assets = await downloadIconAssets(domain);
    if (assets === null) {
      const restoredFolder = await restoreDomainAssets(domain, iconsDir, fallbackIconsDir);
      if (restoredFolder) {
        return {
          domain,
          folder: restoredFolder,
          status: "kept",
        };
      }
      return {
        domain,
        status: "failed",
      };
    }

    assignAssetFilenames(domain, assets);
    const savedFolder = await saveDomainAssets(domain, assets, iconsDir);
    return {
      domain,
      folder: savedFolder,
      iconCount: assets.length,
      status: "ok",
    };
  });

  for (const result of domainResults) {
    if (result.status === "ok") {
      console.log(`[ok] ${result.domain} -> ${relativeFolderPath(result.folder)} (${result.iconCount} icons)`);
      indexedDomains.push(result.domain);
      downloaded += 1;
      continue;
    }

    if (result.status === "kept") {
      console.log(`[keep] ${result.domain} -> ${relativeFolderPath(result.folder)} (previous snapshot)`);
      indexedDomains.push(result.domain);
      restored += 1;
      continue;
    }

    failedDomains.push(result.domain);
  }

  const indexMetadata = buildIndexMetadata(indexedDomains, releaseVersion);
  await writeIndexMetadataFile(indexMetadata, indexPath);
  console.log(`[index] ${relativeFolderPath(indexPath)} (${indexedDomains.length} domains)`);

  if (failedDomains.length > 0) {
    printIssueBlock("Unresolved download failures:", failedDomains);
  }
  console.log(`Done. Downloaded: ${downloaded}, kept: ${restored}, failed: ${failedDomains.length}/${targetDomains.length}`);

  const failureRate = targetDomains.length > 0 ? failedDomains.length / targetDomains.length : 0;
  if (failureRate > 0.05) {
    console.log(`Failure rate ${(failureRate * 100).toFixed(1)}% exceeds the 5% threshold. Failing the build.`);
    return 1;
  }
  return 0;
}
