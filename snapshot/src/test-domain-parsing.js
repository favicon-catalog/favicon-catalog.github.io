import assert from "node:assert";
import { extractHost, parseDomains } from "./download.js";

function testExtractHost() {
  assert.strictEqual(extractHost("github.com"), "github.com");
  assert.strictEqual(extractHost("https://example.com/path"), "example.com");
  assert.strictEqual(extractHost("http://sub.domain.co.uk"), "sub.domain.co.uk");
  assert.strictEqual(extractHost("invalid host"), null);
}

function testParseDomains() {
  const lines = [
    "example.com",
    "- blog.example.com",
    "github.com",
    "- docs.github.com",
    "- enterprise.github.com",
  ];

  const [domains, issues] = parseDomains(lines);
  assert.deepStrictEqual(issues, []);
  assert.deepStrictEqual(domains, [
    "example.com",
    "blog.example.com",
    "github.com",
    "docs.github.com",
    "enterprise.github.com",
  ]);
}

function run() {
  console.log("Running domain parsing tests...");
  testExtractHost();
  testParseDomains();
  console.log("All tests passed.");
}

run();
