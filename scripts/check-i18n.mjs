import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALES_DIR = resolve(process.cwd(), 'src', 'locales');
const BASE_LOCALE = 'en.json';
const TARGET_LOCALES = ['pt-PT.json', 'pt-BR.json', 'es.json'];

const PLACEHOLDER_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function flatten(obj, prefix = '', out = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value, nextKey, out);
    } else {
      out.set(nextKey, String(value));
    }
  }
  return out;
}

function extractPlaceholders(text) {
  const matches = new Set();
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    matches.add(match[1]);
  }
  return matches;
}

function setDiff(a, b) {
  return [...a].filter((item) => !b.has(item));
}

const basePath = resolve(LOCALES_DIR, BASE_LOCALE);
const baseFlat = flatten(readJson(basePath));
const baseKeys = new Set(baseFlat.keys());

let hasErrors = false;

for (const localeFile of TARGET_LOCALES) {
  const localePath = resolve(LOCALES_DIR, localeFile);
  const localeFlat = flatten(readJson(localePath));
  const localeKeys = new Set(localeFlat.keys());

  const missing = setDiff(baseKeys, localeKeys);
  const extra = setDiff(localeKeys, baseKeys);

  if (missing.length || extra.length) {
    hasErrors = true;
    console.error(`\n[${localeFile}] Key mismatch`);
    if (missing.length) {
      console.error(`  Missing (${missing.length}): ${missing.join(', ')}`);
    }
    if (extra.length) {
      console.error(`  Extra (${extra.length}): ${extra.join(', ')}`);
    }
  }

  const placeholderIssues = [];
  for (const key of baseKeys) {
    const baseValue = baseFlat.get(key) ?? '';
    const localeValue = localeFlat.get(key) ?? '';
    const basePlaceholders = extractPlaceholders(baseValue);
    const localePlaceholders = extractPlaceholders(localeValue);
    const missingPh = setDiff(basePlaceholders, localePlaceholders);
    const extraPh = setDiff(localePlaceholders, basePlaceholders);

    if (missingPh.length || extraPh.length) {
      placeholderIssues.push({ key, missingPh, extraPh });
    }
  }

  if (placeholderIssues.length) {
    hasErrors = true;
    console.error(`\n[${localeFile}] Placeholder mismatch (${placeholderIssues.length})`);
    for (const issue of placeholderIssues) {
      console.error(`  - ${issue.key}`);
      if (issue.missingPh.length) {
        console.error(`    Missing placeholders: ${issue.missingPh.join(', ')}`);
      }
      if (issue.extraPh.length) {
        console.error(`    Extra placeholders: ${issue.extraPh.join(', ')}`);
      }
    }
  }
}

if (hasErrors) {
  console.error('\ni18n validation failed.');
  process.exit(1);
}

console.log('i18n validation passed: keys and placeholders are aligned.');
