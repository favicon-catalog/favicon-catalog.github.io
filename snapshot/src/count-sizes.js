import { promises as fs } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { resolveOutputPaths } from "./output-paths.js";

const ANSI_RE = /\x1b\[[0-9;]*m/g;
const ENABLE_COLOR = Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env);
const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  bold: "\x1b[1m",
};

function renderTable(headers, rows) {
  const materialized = rows.map((row) => row.map((cell) => String(cell)));
  const widths = headers.map((header) => visibleWidth(header));
  for (const row of materialized) {
    row.forEach((cell, index) => {
      widths[index] = Math.max(widths[index], visibleWidth(cell));
    });
  }

  function formatRow(row) {
    return row
      .map((cell, index) => padCell(cell, widths[index], index === 0))
      .join("  ");
  }

  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  return [formatRow(headers), separator, ...materialized.map((row) => formatRow(row))].join("\n");
}

function visibleWidth(value) {
  return String(value).replaceAll(ANSI_RE, "").length;
}

function padCell(value, width, leftAlign) {
  const text = String(value);
  const padding = Math.max(0, width - visibleWidth(text));
  return leftAlign ? `${text}${" ".repeat(padding)}` : `${" ".repeat(padding)}${text}`;
}

function colorize(text, color) {
  if (!ENABLE_COLOR) {
    return String(text);
  }
  return `${color}${text}${COLORS.reset}`;
}

function colorizeCount(value) {
  if (value === 0) {
    return colorize("-", COLORS.dim);
  }
  if (value < 10) {
    return String(value);
  }
  if (value >= 40) {
    return colorize(value, `${COLORS.bold}${COLORS.red}`);
  }
  if (value >= 20) {
    return colorize(value, COLORS.yellow);
  }
  return colorize(value, COLORS.cyan);
}

async function walkFiles(root, visit) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const targetPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(targetPath, visit);
    } else if (entry.isFile()) {
      await visit(targetPath);
    }
  }
}

function parseSizeArgs(argv) {
  parseArgs({
    args: argv,
    allowPositionals: false,
    options: {},
  });
}

export async function main(argv = []) {
  parseSizeArgs(argv);
  const { iconsDir } = await resolveOutputPaths();
  const sizeCounter = new Map();
  const extCounter = new Map();
  const sizeExtCounter = new Map();
  let manifestCount = 0;
  let iconCount = 0;
  let emptySizes = 0;
  const issues = [];

  await walkFiles(iconsDir, async (targetPath) => {
    if (path.basename(targetPath) !== "manifest.json") {
      return;
    }
    manifestCount += 1;
    let payload;
    try {
      payload = JSON.parse(await fs.readFile(targetPath, "utf8"));
    } catch (error) {
      issues.push(`${targetPath}: ${error.message}`);
      return;
    }

    if (!Array.isArray(payload.icons)) {
      issues.push(`${targetPath}: icons must be a list`);
      return;
    }

    for (const icon of payload.icons) {
      iconCount += 1;
      if (!icon || typeof icon !== "object" || Array.isArray(icon)) {
        issues.push(`${targetPath}: each icon must be an object`);
        continue;
      }

      const fileName = icon.file ?? "<unknown>";
      const sizes = icon.sizes;
      const extension = path.extname(fileName).slice(1).toLowerCase();
      if (!extension) {
        issues.push(`${targetPath}: invalid file extension for ${JSON.stringify(fileName)}`);
        continue;
      }
      if (!Array.isArray(sizes)) {
        issues.push(`${targetPath}: invalid sizes for ${JSON.stringify(fileName)}`);
        continue;
      }

      extCounter.set(extension, (extCounter.get(extension) || 0) + 1);
      if (sizes.length === 0) {
        emptySizes += 1;
      }
      for (const size of sizes) {
        if (!Number.isInteger(size)) {
          issues.push(`${targetPath}: non-integer size for ${JSON.stringify(fileName)}: ${JSON.stringify(size)}`);
          continue;
        }
        sizeCounter.set(size, (sizeCounter.get(size) || 0) + 1);
        const key = `${extension}:${size}`;
        sizeExtCounter.set(key, (sizeExtCounter.get(key) || 0) + 1);
      }
    }
  });

  console.log(`manifests: ${manifestCount}`);
  console.log(`icons: ${iconCount}`);
  console.log(`icons with empty sizes: ${emptySizes}`);
  console.log("");

  const orderedExts = [...extCounter.keys()].sort();
  console.log("ext totals");
  console.log(renderTable(
    ["ext", "icons"],
    orderedExts.map((ext) => [ext, colorizeCount(extCounter.get(ext) || 0)]),
  ));
  console.log("");

  const orderedSizes = [...sizeCounter.keys()].sort((left, right) => left - right);
  console.log("sizes by ext");
  console.log(renderTable(
    ["size", "total", ...orderedExts],
    orderedSizes
      .map((size) => [
        size,
        colorizeCount(sizeCounter.get(size) || 0),
        ...orderedExts.map((ext) => colorizeCount(sizeExtCounter.get(`${ext}:${size}`) || 0)),
      ]),
  ));

  if (issues.length > 0) {
    console.log("");
    console.log("issues:");
    for (const issue of issues.slice(0, 20)) {
      console.log(`  - ${issue}`);
    }
    if (issues.length > 20) {
      console.log(`  - ... and ${issues.length - 20} more`);
    }
    return 1;
  }
  return 0;
}
