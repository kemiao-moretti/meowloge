import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CANONICAL_BUILD = `build:\n  render: never\n  list: local`;
const CANONICAL_BUILD_LINES = CANONICAL_BUILD.split("\n");
const FRONT_MATTER_RE = /^---(\r?\n)([\s\S]*?)(\r?\n)---(\r?\n|$)/;

function parseFrontMatter(source) {
  const match = source.match(FRONT_MATTER_RE);
  if (!match) return null;
  const [, openingNewline, frontMatter, closingNewline, afterClosing] = match;
  return { openingNewline, closingNewline, afterClosing, frontMatter, prefixLength: match[0].length };
}

function buildRange(lines) {
  const starts = lines.reduce((matches, line, index) => {
    if (/^build\s*:/.test(line)) matches.push(index);
    return matches;
  }, []);
  if (starts.length > 1) throw new Error("ambiguous front matter: duplicate top-level build keys");
  if (starts.length === 0) return null;
  const start = starts[0];
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z0-9_-]+\s*:/.test(lines[end])) end += 1;
  if (lines.slice(start + 1, end).some((line) => line.trim() && !/^\s+/.test(line))) {
    throw new Error("ambiguous front matter: malformed build block");
  }
  return { start, end };
}

export function hasCanonicalBuild(source) {
  const parsed = parseFrontMatter(source);
  if (!parsed) return false;
  const lines = parsed.frontMatter.split(/\r?\n/);
  const range = buildRange(lines);
  return Boolean(range && lines.slice(range.start, range.end).join("\n") === CANONICAL_BUILD);
}

export function ensureChangelogBuild(source) {
  const parsed = parseFrontMatter(source);
  if (!parsed || hasCanonicalBuild(source)) return source;

  const lines = parsed.frontMatter.split(/\r?\n/);
  const range = buildRange(lines);
  const nextLines = range
    ? [...lines.slice(0, range.start), ...CANONICAL_BUILD_LINES, ...lines.slice(range.end)]
    : [...lines, ...CANONICAL_BUILD_LINES];
  const nextFrontMatter = nextLines.join(parsed.openingNewline);
  const body = source.slice(parsed.prefixLength - parsed.afterClosing.length);
  return `---${parsed.openingNewline}${nextFrontMatter}${parsed.closingNewline}---${body}`;
}

async function walkMarkdown(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkMarkdown(fullPath));
    else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "_index.md") files.push(fullPath);
  }
  return files.sort();
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const directory = path.join(root, "content", "changelog");
  let changed = 0;
  for (const file of await walkMarkdown(directory)) {
    const source = await fs.readFile(file, "utf8");
    const next = ensureChangelogBuild(source);
    if (next === source) continue;
    await fs.writeFile(file, next, "utf8");
    changed += 1;
    console.log(`[ok] ${path.relative(root, file).replaceAll(path.sep, "/")}`);
  }
  console.log(`changelog defaults: changed ${changed} files`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
