import assert from "node:assert";
import { insertDomainEntry, parseAddDomainArgs } from "./add-domain.js";
import { extractHost, parseDomainConfig } from "./download.js";
import { parseSnapshotInputDocument, stringifySnapshotInputFile } from "./input-file.js";

function testExtractHost() {
  assert.strictEqual(extractHost("github.com"), "github.com");
  assert.strictEqual(extractHost("https://example.com/path"), "example.com");
  assert.strictEqual(extractHost("http://sub.domain.co.uk"), "sub.domain.co.uk");
  assert.strictEqual(extractHost("invalid host"), null);
}

function testParseDomainConfig() {
  const config = [
    {
      name: "example.com",
      group: "Example",
      subdomains: ["blog.example.com"],
    },
    {
      name: "github.com",
      group: "GitHub",
      subdomains: ["docs.github.com", "enterprise.github.com"],
    },
  ];

  const { domains, entries, groups, groupLabels, issues } = parseDomainConfig(config);
  assert.deepStrictEqual(issues, []);
  assert.deepStrictEqual(domains, [
    "example.com",
    "blog.example.com",
    "github.com",
    "docs.github.com",
    "enterprise.github.com",
  ]);
  assert.deepStrictEqual(entries, [
    { domain: "example.com", group: "Example", subdomains: ["blog.example.com"] },
    { domain: "github.com", group: "GitHub", subdomains: ["docs.github.com", "enterprise.github.com"] },
  ]);
  assert.deepStrictEqual(groups, [
    { parent: "example.com", subdomains: ["blog.example.com"] },
    { parent: "github.com", subdomains: ["docs.github.com", "enterprise.github.com"] },
  ]);
  assert.deepStrictEqual([...groupLabels.entries()], [
    ["Example", ["example.com"]],
    ["GitHub", ["github.com"]],
  ]);
}

function testParseDomainConfigOrderingIssues() {
  const { issues } = parseDomainConfig([
    {
      name: "github.com",
      group: "GitHub",
      subdomains: ["docs.github.com"],
    },
    {
      name: "example.com",
      group: "Example",
      subdomains: ["a.example.com"],
    },
  ]);

  assert.deepStrictEqual(issues, [
    "entry 2: parent domains are not in alphabetical order ('github.com' should not come before 'example.com')",
  ]);
}

function testParseDomainConfigSubdomainIssues() {
  const { issues } = parseDomainConfig([
    {
      name: "example.com",
      subdomains: ["zzz.example.com", "aaa.example.com"],
    },
  ]);

  assert.deepStrictEqual(issues, [
    "entry 1: subdomains for 'example.com' are not in alphabetical order ('zzz.example.com' should not come before 'aaa.example.com')",
  ]);
}

function testParseDomainConfigNestedSubdomainIssue() {
  const { issues } = parseDomainConfig([
    {
      name: "example.com",
      subdomains: ["a.b.example.com"],
    },
  ]);

  assert.deepStrictEqual(issues, [
    "entry 1: subdomain 'a.b.example.com' must be a direct child of parent domain 'example.com'",
  ]);
}

function testParseDomainConfigRejectsWwwDomain() {
  const { issues } = parseDomainConfig([
    {
      name: "www.example.com",
    },
  ]);

  assert.deepStrictEqual(issues, [
    "entry 1: domain 'www.example.com' must not use the 'www' subdomain",
  ]);
}

function testParseDomainConfigRejectsWwwSubdomain() {
  const { issues } = parseDomainConfig([
    {
      name: "example.com",
      subdomains: ["www.example.com"],
    },
  ]);

  assert.deepStrictEqual(issues, [
    "entry 1: subdomain 'www.example.com' must not use the 'www' subdomain",
  ]);
}

function testParseSnapshotInputDocument() {
  const parsed = parseSnapshotInputDocument({
    version: "0.1.5",
    domains: [{ name: "example.com" }],
  });

  assert.deepStrictEqual(parsed, {
    version: "0.1.5",
    domains: [{ name: "example.com" }],
    issues: [],
  });
}

function testParseSnapshotInputDocumentRejectsLegacyRoot() {
  const parsed = parseSnapshotInputDocument([
    { name: "example.com" },
  ]);

  assert.deepStrictEqual(parsed, {
    version: null,
    domains: null,
    issues: ["input root must be an object"],
  });
}

function testParseSnapshotInputDocumentRejectsInvalidVersion() {
  const parsed = parseSnapshotInputDocument({
    version: "latest",
    domains: [],
  });

  assert.deepStrictEqual(parsed, {
    version: "latest",
    domains: [],
    issues: ["version must be a valid semver string"],
  });
}

function testStringifySnapshotInputFileUsesCanonicalYamlFormatting() {
  const text = stringifySnapshotInputFile({
    version: "0.1.5",
    domains: [
      {
        name: "example.com",
        subdomains: ["docs.example.com"],
      },
    ],
  });

  assert.strictEqual(text, [
    "version: 0.1.5",
    "domains:",
    "- name: example.com",
    "  subdomains:",
    "  - docs.example.com",
    "",
  ].join("\n"));
}

function testInsertDomainEntry() {
  const updated = insertDomainEntry([
    { name: "apple.com" },
    { name: "google.com", group: "Google" },
  ], {
    domain: "github.com",
    group: "GitHub",
    subdomains: ["enterprise.github.com", "docs.github.com", "docs.github.com"],
  });

  assert.deepStrictEqual(updated, [
    { name: "apple.com" },
    {
      name: "github.com",
      group: "GitHub",
      subdomains: ["docs.github.com", "enterprise.github.com"],
    },
    { name: "google.com", group: "Google" },
  ]);
}

function testInsertDomainEntryDuplicate() {
  assert.throws(() => {
    insertDomainEntry([
      { name: "github.com", subdomains: ["docs.github.com"] },
    ], {
      domain: "docs.github.com",
    });
  }, /already exists as a subdomain/);
}

function testInsertSubdomainIntoExistingParent() {
  const updated = insertDomainEntry([
    { name: "apple.com" },
    { name: "github.com", subdomains: ["pages.github.com"] },
  ], {
    domain: "docs.github.com",
  });

  assert.deepStrictEqual(updated, [
    { name: "apple.com" },
    { name: "github.com", subdomains: ["docs.github.com", "pages.github.com"] },
  ]);
}

function testInsertSubdomainCreatesMissingParent() {
  const updated = insertDomainEntry([
    { name: "apple.com" },
    { name: "github.com", subdomains: ["pages.github.com"] },
  ], {
    domain: "sub.example.com",
  });

  assert.deepStrictEqual(updated, [
    { name: "apple.com" },
    { name: "example.com", subdomains: ["sub.example.com"] },
    { name: "github.com", subdomains: ["pages.github.com"] },
  ]);
}

function testInsertNestedSubdomainRejectedForExistingParent() {
  assert.throws(() => {
    insertDomainEntry([
      { name: "example.com" },
    ], {
      domain: "a.b.example.com",
    });
  }, /must be a direct child of parent domain 'example.com'/);
}

function testInsertWwwDomainRejected() {
  assert.throws(() => {
    insertDomainEntry([], {
      domain: "www.example.com",
    });
  }, /must not use the 'www' subdomain/);
}

function testInsertDomainEntryNormalizesExistingOrdering() {
  const updated = insertDomainEntry([
    { name: "live.com" },
    { name: "lguplus.com" },
  ], {
    domain: "microsoft.com",
  });

  assert.deepStrictEqual(updated, [
    { name: "lguplus.com" },
    { name: "live.com" },
    { name: "microsoft.com" },
  ]);
}

function testParseAddDomainArgs() {
  assert.deepStrictEqual(parseAddDomainArgs([
    "github.com",
    "--group",
    "GitHub",
    "--subdomain",
    "docs.github.com",
    "--subdomain",
    "enterprise.github.com",
  ]), {
    domain: "github.com",
    group: "GitHub",
    subdomains: ["docs.github.com", "enterprise.github.com"],
  });
}

function run() {
  console.log("Running domain parsing tests...");
  testExtractHost();
  testParseDomainConfig();
  testParseDomainConfigOrderingIssues();
  testParseDomainConfigSubdomainIssues();
  testParseDomainConfigNestedSubdomainIssue();
  testParseDomainConfigRejectsWwwDomain();
  testParseDomainConfigRejectsWwwSubdomain();
  testParseSnapshotInputDocument();
  testParseSnapshotInputDocumentRejectsLegacyRoot();
  testParseSnapshotInputDocumentRejectsInvalidVersion();
  testStringifySnapshotInputFileUsesCanonicalYamlFormatting();
  testInsertDomainEntry();
  testInsertDomainEntryDuplicate();
  testInsertSubdomainIntoExistingParent();
  testInsertSubdomainCreatesMissingParent();
  testInsertNestedSubdomainRejectedForExistingParent();
  testInsertWwwDomainRejected();
  testInsertDomainEntryNormalizesExistingOrdering();
  testParseAddDomainArgs();
  console.log("All tests passed.");
}

run();
