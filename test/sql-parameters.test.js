const {describe, it} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Guard against string-built SQL coming back: a quoted interpolation ('${...}') or a quote concatenation ("'" + ...)
const STRING_BUILT_SQL = /'\$\{|"'"\s*\+/;

const listJavaScriptFiles = (directory) =>
  fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(entryPath);
    return entry.name.endsWith(".js") ? [entryPath] : [];
  });

describe("SQL in src", () => {
  it("passes every value as a query parameter instead of building it into the SQL text", () => {
    const offendingLines = listJavaScriptFiles(path.join(__dirname, "../src")).flatMap((filePath) =>
      fs
        .readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .map((line, index) => ({line, location: `${path.relative(path.join(__dirname, ".."), filePath)}:${index + 1}`}))
        .filter(({line}) => STRING_BUILT_SQL.test(line))
        .map(({line, location}) => `${location}  ${line.trim()}`),
    );

    assert.deepEqual(offendingLines, []);
  });
});
