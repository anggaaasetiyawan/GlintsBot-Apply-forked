// Derive Jobstreet `searchKeywords` and `location` so the bot doesn't need
// hand-tuned config. Mirrors the Glints `src/auto-keywords.ts` contract, but
// sources evidence locally instead of from an authenticated API:
//
//   keywords ← applied-job titles (history)
//            + config.filters.includeKeywords      (seed hints)
//            − config.filters.excludeKeywords      (negative filter)
//            − stop words / junk tokens
//   location ← config.jobstreet.location          (explicit wins)
//            + applied-job locations if the config value is absent
//            + candidate domicile as the last resort
//
// Everything is failure-tolerant: a missing or corrupt history file just yields
// the configured keywords.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppliedRecord } from "../storage.js";

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "at", "on", "by", "with", "from",
  "as", "is", "are", "be", "been", "being", "that", "this", "it", "its", "into", "over",
  "more", "than", "using", "via", "plus", "also", "etc", "such", "other", "some", "any",
  "each", "per", "not", "no", "yes", "you", "we", "our", "us", "my", "your", "their",
  "staff", "senior", "junior", "intern", "internship", "contract", "temporary", "part",
  "full", "time", "job", "jobs", "vacancy", "vacancies", "urgent", "needed", "wanted",
  "pt", "cv", "tbk", "ltd", "inc", "corp", "group", "indonesia", "jakarta", "remote",
  "onsite", "hybrid", "wfo", "wfh", "researcher", "consultant",
  // Indonesian stop words
  "yang", "dan", "atau", "di", "ke", "dari", "untuk", "dengan", "pada", "oleh", "dalam",
  "akan", "sudah", "masih", "juga", "saja", "ini", "itu", "ada", "tidak", "kami", "kita",
  "mereka", "dia", "sebagai", "secara", "seperti", "supaya", "agar", "lebih", "banyak",
  "sangat", "cukup", "tahun", "bulan", "hari", "kerja", "posisi", "lowongan",
  "pengalaman", "dibutuhkan", "diperlukan",
]);

/** Multi-word keyword shapes worth keeping verbatim (Jobstreet search is phrase-aware). */
const ROLE_PHRASES: { re: RegExp; key: string }[] = [
  { re: /\bfull[\s-]?stack\b/i, key: "fullstack developer" },
  { re: /\bback[\s-]?end\b/i, key: "backend developer" },
  { re: /\bfront[\s-]?end\b/i, key: "frontend developer" },
  { re: /\bweb\s*(developer|dev)\b/i, key: "web developer" },
  { re: /\b(mobile|android|ios)\s*(developer|dev|engineer)\b/i, key: "mobile developer" },
  { re: /\bdev[\s-]?ops\b/i, key: "devops engineer" },
  { re: /\bdata\s*(engineer|scientist|analyst)\b/i, key: "data engineer" },
  { re: /\b(machine\s*learning|ml)\s*(engineer|developer)\b/i, key: "machine learning engineer" },
  { re: /\bai\s*(engineer|developer|specialist|researcher|consultant)\b/i, key: "ai engineer" },
  { re: /\bqa\s*(engineer|automation)\b/i, key: "qa engineer" },
  { re: /\bsoftware\s*(engineer|developer)\b/i, key: "software engineer" },
  { re: /\bcloud\s*(engineer|architect)\b/i, key: "cloud engineer" },
  { re: /\b(it|technical)\s*support\b/i, key: "it support" },
  { re: /\blaravel\b/i, key: "laravel developer" },
  { re: /\breact(\s*(js|developer|engineer))?\b/i, key: "react developer" },
  { re: /\bnode(\.?js)?\s*(developer|engineer)?\b/i, key: "node.js developer" },
  { re: /\bphp\s*(developer|programmer)\b/i, key: "php developer" },
  { re: /\b(python|golang|go|java|kotlin|flutter|golang)\s*(developer|engineer|programmer)\b/i, key: "backend developer" },
];

/** Role nouns that make a bare token a plausible search phrase. */
const ROLE_NOUNS = new Set([
  "developer", "engineer", "programmer", "pengembang", "architect", "analyst",
  "administrator", "admin", "specialist", "scientist", "designer",
]);

/** Known Indonesian locations, so a weight-1 mention still counts as a location. */
/** Real place names only. Work arrangements ("remote", "hybrid") are NOT locations. */
const KNOWN_LOCATIONS = new Set([
  "jakarta", "bontang", "bandung", "surabaya", "yogyakarta", "jogja", "semarang",
  "medan", "makassar", "bekasi", "depok", "tangerang", "bogor", "malang", "denpasar",
  "balikpapan", "samarinda", "pontianak", "manado", "padang", "palembang", "batam",
  "pekanbaru", "solo", "surakarta", "cikarang", "karawang", "serpong", "bsd",
  "sidoarjo", "gresik", "bandar lampung", "lampung", "cirebon", "tasikmalaya",
]);

/**
 * Tokens that look like locations but are work arrangements or generic words.
 * They poison a search URL (`in-remote` is legal but almost never the intent).
 */
const NOT_A_LOCATION = new Set([
  "remote", "hybrid", "onsite", "on-site", "wfh", "wfo", "anywhere", "global",
  "worldwide", "international", "overseas", "luar", "negeri", "dalam",
]);

export interface DerivedJobstreet {
  keywords: string[];
  location: string;
  source: { history: number; config: number; excluded: number };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.+#-]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Read the Jobstreet applied history. Never throws. */
export function readHistory(path = ".glints/jobstreet-history.json"): AppliedRecord[] {
  const full = resolve(process.cwd(), path);
  if (!existsSync(full)) return [];
  try {
    const parsed = JSON.parse(readFileSync(full, "utf8")) as { applied?: AppliedRecord[] };
    const rows = parsed.applied;
    return Array.isArray(rows) ? rows.filter((r) => typeof r?.title === "string") : [];
  } catch {
    return [];
  }
}

/** Normalize a location label to a URL-safe slug ("Jakarta Selatan" → "jakarta-selatan"). */
export function slugLocation(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface DeriveOptions {
  mode?: "tech" | "all" | "custom";
  customTokens?: string[];
  extraRoleNouns?: string[];
  /** Seed hints folded into the token pool at weight 2. */
  includeHints?: string[];
  /** Negative filter — matches are dropped entirely. */
  excludeKeywords?: string[];
  /** Hard override (config `locationOverride` / `JOBSTREET_LOCATION` env). Wins over everything. */
  explicitLocation?: string;
  /** Fallback location used only when nothing else yields a location. */
  fallbackLocation?: string;
  /** Candidate domicile, used only when nothing else yields a location. */
  domicile?: string;
  max?: number;
  historyPath?: string;
}

/**
 * Derive Jobstreet search keywords + location from applied history and config.
 *
 * Precedence for `location`: `explicitLocation` → most frequent location seen in
 * applied history → `fallbackLocation` → `domicile` → `"jakarta"`.
 *
 * Keywords are ranked: multi-word role phrases (weight 5) → configured include
 * hints (weight 2) → bare role nouns seen in history (weight 2) → other tokens
 * (weight 1). `excludeKeywords` entries are stripped before ranking.
 */
export function deriveJobstreetConfig(opts: DeriveOptions = {}): DerivedJobstreet {
  const mode = opts.mode ?? "tech";
  const max = opts.max ?? 12;
  const custom = new Set((opts.customTokens ?? []).map((t) => t.toLowerCase().trim()));
  const extraNouns = new Set((opts.extraRoleNouns ?? []).map((t) => t.toLowerCase().trim()));
  const excludes = (opts.excludeKeywords ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean);

  const records = readHistory(opts.historyPath);
  const scores = new Map<string, number>();
  const locations = new Map<string, number>();

  const isExcluded = (k: string): boolean =>
    excludes.some((x) => x.length > 2 && (k === x || k.includes(x) || x.includes(k)));

  const bump = (key: string, weight: number): void => {
    const k = key.toLowerCase().trim();
    if (!k || k.length < 3) return;
    if (STOP_WORDS.has(k)) return;
    if (/^\d+$/.test(k)) return;
    if (isExcluded(k)) return;
    scores.set(k, (scores.get(k) ?? 0) + weight);
  };

  // 1) Applied-job titles → role phrases + tokens + location sightings.
  for (const rec of records) {
    const title = rec.title;
    for (const { re, key } of ROLE_PHRASES) {
      if (re.test(title)) bump(key, 5);
    }
    for (const tok of tokenize(title)) {
      if (KNOWN_LOCATIONS.has(tok) && !NOT_A_LOCATION.has(tok)) {
        locations.set(tok, (locations.get(tok) ?? 0) + 1);
      }
      if (ROLE_NOUNS.has(tok) || custom.has(tok)) bump(tok, 2);
      else if (mode === "all") bump(tok, 1);
    }
    // Company names sometimes carry a city ("PT Cahaya Jakarta").
    for (const tok of tokenize(rec.company ?? "")) {
      if (KNOWN_LOCATIONS.has(tok) && !NOT_A_LOCATION.has(tok)) {
        locations.set(tok, (locations.get(tok) ?? 0) + 1);
      }
    }
    // Recorded search location — the strongest single location signal we have.
    const recLoc = slugLocation(rec.location ?? "");
    if (recLoc && !NOT_A_LOCATION.has(recLoc)) {
      locations.set(recLoc, (locations.get(recLoc) ?? 0) + 3);
    }
  }

  // 2) Config include-keywords are hints, weighted below observed history.
  for (const hint of opts.includeHints ?? []) {
    for (const { re, key } of ROLE_PHRASES) {
      if (re.test(hint)) bump(key, 5);
    }
    const toks = tokenize(hint);
    if (toks.length > 1 && toks.length <= 3) bump(toks.join(" "), 2);
    for (const tok of toks) {
      if (ROLE_NOUNS.has(tok) || custom.has(tok) || extraNouns.has(tok)) bump(tok, 2);
    }
  }

  const source = {
    history: records.length,
    config: (opts.includeHints ?? []).length,
    excluded: excludes.length,
  };

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  // Keep at most one variant per role family ("frontend developer" beats "frontend").
  const picked: string[] = [];
  const seenRoot = new Set<string>();
  for (const [k] of ranked) {
    const root = k.split(/[\s.-]/)[0] ?? k;
    if (seenRoot.has(root) && !k.includes(" ")) continue;
    seenRoot.add(root);
    picked.push(k);
    if (picked.length >= max) break;
  }

  const keywords = picked.length > 0 ? picked : [];

  // Location precedence (highest first):
  //   1. explicit override (config `locationOverride` / env) — always wins
  //   2. most frequent location recorded/sighted in history
  //   3. configured `location` (fallback so an empty history keeps working)
  //   4. answer-bank domicile
  //   5. "jakarta"
  const explicit = slugLocation(opts.explicitLocation ?? "");
  let location = "";
  if (explicit) {
    location = explicit;
  } else if (locations.size > 0) {
    const best = [...locations.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) location = slugLocation(best[0]);
  }
  if (!location) location = slugLocation(opts.fallbackLocation ?? "");
  if (!location && opts.domicile) {
    // "Bontang, Indonesia" → "bontang"
    const city = opts.domicile.split(",")[0]?.trim() ?? "";
    location = slugLocation(city);
  }
  if (!location) location = "jakarta";

  return { keywords, location, source };
}
