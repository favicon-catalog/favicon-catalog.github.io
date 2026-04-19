export function utcTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isJsonScalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

export function formatManifestJson(value, indent = 0) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (value.every((item) => isJsonScalar(item))) {
      return `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
    }
    const innerIndent = indent + 2;
    const lines = ["["];
    value.forEach((item, index) => {
      const comma = index < value.length - 1 ? "," : "";
      lines.push(`${" ".repeat(innerIndent)}${formatManifestJson(item, innerIndent)}${comma}`);
    });
    lines.push(`${" ".repeat(indent)}]`);
    return lines.join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return "{}";
    }
    const innerIndent = indent + 2;
    const lines = ["{"];
    entries.forEach(([key, item], index) => {
      const comma = index < entries.length - 1 ? "," : "";
      lines.push(`${" ".repeat(innerIndent)}${JSON.stringify(key)}: ${formatManifestJson(item, innerIndent)}${comma}`);
    });
    lines.push(`${" ".repeat(indent)}}`);
    return lines.join("\n");
  }
  return JSON.stringify(value);
}
