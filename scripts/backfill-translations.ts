/**
 * Fills keys that are missing in a locale with the English text, and drops
 * keys that no longer exist in English. Keeps `check:translations` green
 * when new strings land in `en` (and `es`) before translators catch up.
 *
 *   bun scripts/backfill-translations.ts
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.join(__dirname, "..", "src", "i18n", "locales");
const REFERENCE_LANG = "en";

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Returns `target` reshaped to the key set and key order of `reference`. */
function align(reference: Json, target: Json, counts: Counts): Json {
  const out: Json = {};
  for (const key of Object.keys(reference)) {
    const ref = reference[key];
    const cur = target[key];
    if (isObject(ref)) {
      out[key] = align(ref, isObject(cur) ? cur : {}, counts);
    } else if (cur === undefined || isObject(cur)) {
      out[key] = ref;
      counts.added += 1;
    } else {
      out[key] = cur;
    }
  }
  counts.removed += countExtra(reference, target);
  return out;
}

function countExtra(reference: Json, target: Json): number {
  let extra = 0;
  for (const key of Object.keys(target)) {
    if (!(key in reference)) extra += 1;
  }
  return extra;
}

interface Counts {
  added: number;
  removed: number;
}

const readJson = (file: string): Json =>
  JSON.parse(fs.readFileSync(file, "utf8")) as Json;

const reference = readJson(
  path.join(LOCALES_DIR, REFERENCE_LANG, "translation.json"),
);

const languages = fs
  .readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== REFERENCE_LANG)
  .map((entry) => entry.name)
  .sort();

for (const lang of languages) {
  const file = path.join(LOCALES_DIR, lang, "translation.json");
  const counts: Counts = { added: 0, removed: 0 };
  const aligned = align(reference, readJson(file), counts);
  fs.writeFileSync(file, `${JSON.stringify(aligned, null, 2)}\n`);
  if (counts.added > 0 || counts.removed > 0) {
    console.log(`${lang}: +${counts.added} -${counts.removed}`);
  }
}
