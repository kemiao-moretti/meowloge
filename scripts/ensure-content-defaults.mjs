import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CANONICAL_BUILD = `build:\n  render: never\n  list: local`;
const CANONICAL_BUILD_LINES = CANONICAL_BUILD.split("\n");

function parseFrontMatter(source) {
  const opening = source.match(/^---(\r?\n)/);
  if (!opening) return null;
  const openingNewline = opening[1];
  const start = opening[0].length;
  const chunks = source.slice(start).split(/(?<=\r\n|\n)/);
  const lines = [];
  let scalarIndent = null;
  let scalarExplicit = false;
  let scalarHasContent = false;
  let offset = start;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const newline = chunk.endsWith("\r\n") ? "\r\n" : chunk.endsWith("\n") ? "\n" : "";
    const line = newline ? chunk.slice(0, -newline.length) : chunk;
    const delimiter = /^---\s*$/.test(line);
    if (scalarIndent !== null) {
      const indent = (line.match(/^\s*/) || [""])[0].length;
      if (delimiter && indent < scalarIndent && scalarExplicit) scalarIndent = null;
      else if (delimiter && scalarHasContent) {
        // A delimiter after ordinary scalar content is the valid closing marker.
        // Reject the known ambiguous shape where another indented scalar-looking
        // line and a second delimiter follow it; fail closed rather than guessing.
        const nextLine = chunks[index + 1]?.replace(/\r?\n$/, "") || "";
        const followingDelimiter = chunks.slice(index + 2).some((candidate) => /^---\s*$/.test(candidate.replace(/\r?\n$/, "")));
        if (/^\s+\S/.test(nextLine) && followingDelimiter) throw new Error("ambiguous front matter: delimiter inside YAML block scalar");
        scalarIndent = null;
      }
      if (delimiter && !scalarHasContent) scalarIndent = null;
      if (!line.trim()) continue;
      if (scalarIndent !== null && indent >= scalarIndent) scalarHasContent = true;
      else if (scalarIndent !== null) scalarIndent = null;
    }
    if (scalarIndent === null) {
      const scalar = line.match(/^\s*[A-Za-z0-9_-]+\s*:\s*[|>]([+-]?)(\d*)\s*$/);
      if (scalar) {
        scalarExplicit = Boolean(scalar[2]);
        scalarIndent = scalar[2] ? Number(scalar[2]) : 1;
        scalarHasContent = false;
      }
    }
    if (scalarIndent === null && delimiter) {
      const frontMatter = source.slice(start, offset).replace(/\r?\n$/, "");
      const delimiterEnd = offset + line.length;
      return { openingNewline, closingNewline: newline || openingNewline, afterClosing: source.slice(delimiterEnd), frontMatter, prefixLength: delimiterEnd };
    }
    lines.push({ line, newline });
    offset += chunk.length;
  }
  throw new Error("ambiguous front matter: missing closing delimiter");
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
  if (end === start + 1 && end < lines.length) throw new Error("ambiguous front matter: malformed build block");
  if (lines.slice(start + 1, end).some((line) => line.trim() && !/^\s+/.test(line))) throw new Error("ambiguous front matter: malformed build block");
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
  const nextLines = range ? [...lines.slice(0, range.start), ...CANONICAL_BUILD_LINES, ...lines.slice(range.end)] : [...lines, ...CANONICAL_BUILD_LINES];
  const nextFrontMatter = nextLines.join(parsed.openingNewline);
  const body = source.slice(parsed.prefixLength);
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
