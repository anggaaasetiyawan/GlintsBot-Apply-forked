// Derive include-keywords from the candidate profile so the bot doesn't need
// hand-tuned config. Pulls from:
//   - work experience job titles + skills
//   - job-role preferences (HierarchicalJobCategory names)
//   - the user's intro/bio free text
//
// Result is deduped, lowercased, and trimmed to the most relevant N tokens.

import type { GlintsClient } from "./client.js";
import type { MeFragment } from "./types.js";

const STOP_WORDS = new Set([
  "the","a","an","and","or","of","to","for","in","at","on","by","with","from",
  "as","is","are","be","been","being","that","this","it","its","into","over",
  "more","than","than","using","via","plus","also","etc","such","other","some",
  "any","each","per","not","no","yes","you","we","our","us","my","your","their",
  // Indonesian stop words
  "yang","dan","atau","di","ke","dari","untuk","dengan","pada","oleh","dalam",
  "akan","sudah","masih","juga","saja","ini","itu","ada","tidak","saya","kami",
  "kita","mereka","dia","sebagai","secara","oleh","seperti","supaya","agar",
  "lebih","banyak","sangat","cukup","tahun","bulan","hari","kerja","posisi",
  "lowongan","pengalaman","tahun-tahun",
]);

const BUILTIN_TECH_TOKENS = new Set([
  "developer","engineer","programmer","pengembang",
  "software","programming",
  "fullstack","full-stack","full","stack",
  "backend","back-end","back",
  "frontend","front-end","front",
  "web","mobile","api","rest","graphql","microservice","microservices",
  "node","nodejs","node.js",
  "javascript","typescript","js","ts",
  "react","reactjs","vue","next","nextjs","svelte","angular",
  "php","laravel","codeigniter","symfony",
  "python","django","flask","fastapi",
  "go","golang",
  "java","spring","kotlin",
  ".net","c#","csharp","dotnet",
  "ruby","rails",
  "rust",
  "sql","mysql","postgres","postgresql","mongodb","mongo","redis","sqlite",
  "elasticsearch","mssql","oracle",
  "devops","sre","infrastructure",
  "cloud","aws","gcp","azure","oci",
  "docker","kubernetes","k8s","helm","terraform","ansible",
  "linux","server","system","systems",
  "ai","ml","llm","nlp",
  "data","analytics","etl","pipeline",
  "automation","scripting","crawler","scraper",
  "qa","testing","cypress","playwright","jest",
  "android","ios","flutter","dart","react-native","reactnative",
  "ux","ui","design","designer",
  "product","manager","management","lead","senior","junior","staff","principal",
]);

const BUILTIN_ROLE_NOUNS = new Set([
  "developer","engineer","programmer","pengembang","designer","architect",
  "analyst","scientist","administrator","admin","specialist","consultant",
  "lead","manager","head","director","officer","coordinator","supervisor",
]);

export interface KeywordOptions {
  mode?: "tech" | "all" | "custom";
  customTokens?: string[];
  extraRoleNouns?: string[];
}

export interface DerivedKeywords {
  raw: string[];
  filtered: string[];
  source: { titles: number; skills: number; categories: number; intro: number };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.+#-]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export async function deriveKeywords(client: GlintsClient, me: MeFragment, opts?: KeywordOptions): Promise<DerivedKeywords> {
  const mode = opts?.mode ?? "tech";
  const customTokens = new Set((opts?.customTokens ?? []).map(t => t.toLowerCase().trim()));
  const allTechTokens = new Set([...BUILTIN_TECH_TOKENS, ...customTokens]);
  const allRoleNouns = new Set([
    ...BUILTIN_ROLE_NOUNS,
    ...(opts?.extraRoleNouns ?? []).map(t => t.toLowerCase().trim()),
  ]);
  const tokens = new Map<string, number>(); // token → score
  const bump = (t: string, w: number) => {
    const k = t.toLowerCase().trim();
    if (!k || k.length < 2) return;
    if (STOP_WORDS.has(k)) return;
    if (/^\d+$/.test(k)) return;
    tokens.set(k, (tokens.get(k) ?? 0) + w);
  };

  let titles = 0, skills = 0, categories = 0, intro = 0;

  // Walk an arbitrary object tree and pick out string values on known keys.
  // Resilient to shape changes ("works", "experiences", "data.works", etc.).
  const collectFromTree = (obj: unknown, keyHints: { titles?: string[]; skills?: string[] }): void => {
    if (!obj) return;
    if (typeof obj !== "object") return;
    if (Array.isArray(obj)) { for (const v of obj) collectFromTree(v, keyHints); return; }
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof v === "string") {
        if (keyHints.titles?.includes(k)) {
          for (const t of tokenize(v)) { bump(t, 3); titles++; }
        } else if (keyHints.skills?.includes(k)) {
          for (const t of tokenize(v)) { bump(t, 4); skills++; }
        }
      } else if (v && typeof v === "object") {
        collectFromTree(v, keyHints);
      }
    }
  };

  // 1) Work experiences — walk the tree and pick out title/skill-like fields
  try {
    const exp = await client.getExperiences("PROFILE");
    collectFromTree(exp, {
      titles: ["jobTitle", "title", "jobRoleName"],
      skills: ["name"], // skills arrays carry `{name}` objects
    });
  } catch { /* ignore */ }

  // 2) Job-role preferences (categories the user opted into)
  try {
    const prefs = await client.jobRolePreferences() as unknown;
    const beforeTitles = titles;
    collectFromTree(prefs, { titles: ["name", "title", "categoryName"] });
    // Re-classify: those "title" bumps from this call are actually category bumps
    categories += titles - beforeTitles;
  } catch { /* ignore */ }

  // 3) Intro/bio text
  if (me.intro) {
    for (const t of tokenize(me.intro)) { bump(t, 1); intro++; }
  }

  // Filter tokens based on the configured keyword mode:
  //   "tech"   — only TECH_TOKENS + ROLE_NOUNS (default, for IT roles)
  //   "all"    — keep every meaningful token (for non-IT roles)
  //   "custom" — only customTokens + ROLE_NOUNS
  const ranked = [...tokens.entries()]
    .filter(([k]) => {
      if (k.length < 2) return false;
      switch (mode) {
        case "all":
          return allTechTokens.has(k) || allRoleNouns.has(k) || k.length >= 3;
        case "custom":
          return customTokens.has(k) || allRoleNouns.has(k);
        case "tech":
        default:
          return allTechTokens.has(k) || allRoleNouns.has(k);
      }
    })
    .sort((a, b) => b[1] - a[1]);

  const raw = ranked.map(([k]) => k);
  // Cap to keep includeKeywords sane.
  const filtered = raw.slice(0, 60);

  return { raw, filtered, source: { titles, skills, categories, intro } };
}
