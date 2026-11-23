import type { Page } from "puppeteer";
import { jitter, sleep } from "./browser.js";
import {
  gotoApplied,
  gotoSearch,
  isLoggedIn,
  type ApplyOutcome,
  type JobLink,
  type JobstreetConfig,
  type LogFn,
} from "./types.js";

/**
 * Run page.evaluate() but survive SPA navigations that destroy the JS context.
 * Retries a few times with a short settle delay between attempts.
 *
 * NOTE: `args` is passed to the page callback as a SINGLE argument. Never spread
 * it — spreading turns an array payload into N positional args and the callback
 * silently receives only the first element (e.g. one selector string instead of
 * the selector list), which then explodes inside querySelectorAll.
 */
async function safeEval<T>(
  page: Page,
  fn: (arg: never) => T,
  args?: unknown,
  attempts = 4
): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      return (await page.evaluate(
        fn as unknown as (a: unknown) => T,
        args as unknown
      )) as T;
    } catch (e) {
      const msg = (e as Error).message;
      if (!/Execution context was destroyed|Cannot find context|detached|navigat/i.test(msg)) throw e;
      await sleep(jitter(0.8, 1.6));
    }
  }
  return null;
}

const JOB_LINK_SELECTORS = [
  'a[data-automation="job-list-item-link-overlay"]',
  'a[data-automation="jobTitle"]',
  'a[href*="/job/"]',
];

/** External / already-handled apply affordances we never click. */
const EXTERNAL_APPLY = /^(daftar|apply on company|company website|lamar di|kunjungi situs)/i;
const ALREADY_APPLIED = /(applied|dilamar|sudah dilamar)/i;

/** Text matchers for buttons that live on Jobstreet's own apply flow. */
const APPLY_TRIGGERS = [
  '[data-automation="job-detail-apply"]',
  '[data-automation="apply-now"]',
  '[data-automation="job-detail-apply-button"]',
  '[data-testid="apply-button"]',
  'a[href*="/apply"]',
];

const APPLY_TEXT = /^(lamar cepat|lamaran cepat|lamar sekarang|lamar|quick apply|apply now|apply)$/i;

/**
 * Jobstreet renders its CTAs with a trailing U+2060 WORD JOINER (and sometimes
 * U+200B / U+00A0). `String.prototype.trim()` does NOT strip those, so any
 * anchored regex silently fails. Normalize before every text comparison.
 */
const normalize = (s: string | null | undefined): string =>
  (s ?? "").replace(/[\u2060\u200b\ufeff\u00a0]/g, "").replace(/\s+/g, " ").trim();

const CONTINUE_TEXT =
  /^(continue|lanjut|lanjutkan|next|selanjutnya|review|tinjau|save and continue|pilih dokumen|jawab pertanyaan perusahaan|perbarui profil jobstreet|review dan kirim)$/i;

/** The single advance control on every step of Jobstreet's apply wizard. */
const CONTINUE_SELECTOR = '[data-testid="continue-button"]';
const BACK_SELECTOR = '[data-testid="back-button"]';

/**
 * Real submit CTA. Goes through [data-testid] first: the wizard's step-nav
 * button is literally labelled "Review dan kirim", so matching on /kirim/ alone
 * reports a false "submit reached" on step 0.
 */
const SUBMIT_SELECTORS = [
  '[data-testid="review-submit-application"]',
  '[data-automation="review-submit-application"]',
  '[data-testid="submit-application"]',
  '[data-automation="submit-application"]',
];
const SUBMIT_TEXT = /^(submit application|kirim lamaran|kirim aplikasi|kirim|submit)$/i;

/** Inline-blocking validation banner Jobstreet shows above the wizard. */
const VALIDATION_SELECTOR = '[role="alert"], [data-automation*="error"], .error-message';

/**
 * Answer rules for Jobstreet's screening questionnaire. `match` is tested against
 * the question label; `picks` are option labels in priority order (exact match
 * first, then substring). Anything unmatched falls through to the first real
 * option so the wizard can always advance.
 */
const QUESTION_FALLBACKS: { match: RegExp; picks: string[] }[] = [
  {
    match: /expected monthly (basic )?salary|ekspektasi gaji/i,
    picks: ["Rp 5 million", "Rp 6 million", "Rp 7 million", "Rp 1 million"],
  },
  {
    match: /right to work|hak untuk bekerja/i,
    picks: ["I'm an Indonesian citizen", "I have an Indonesian residence permit (KITAS/KITAP)"],
  },
  {
    match: /qualifications? do you have|kualifikasi/i,
    picks: ["Bachelor Degree (S1)", "Diploma 3", "Bachelor's Degree (S1)"],
  },
  {
    match: /notice period|periode notice/i,
    picks: ["Immediately available", "Immediately", "2 weeks"],
  },
  {
    match: /willing to relocate|bersedia.*pindah/i,
    picks: ["Yes"],
  },
  {
    match: /proficiency|skill level|tingkat keahlian/i,
    picks: ["Intermediate", "Beginner", "Menengah"],
  },
];

/* ------------------------------------------------------------------------- *
 * CV-driven answer rules
 *
 * Every employer profile on Jobstreet can define its own screening questions,
 * but they nearly all come from the same pool: expected salary, years of
 * relevant experience, education, notice period, right to work, relocation,
 * proficiency, languages, work arrangement. The table above only guesses at
 * them; this builder derives the real answers from the answer bank
 * (`config.json → answers`) — i.e. from the CV.
 *
 * Emitted rules MUST stay JSON-serialisable: they cross into page.evaluate().
 * ------------------------------------------------------------------------- */

export interface AnswerRule {
  /** Regex source, tested case-insensitively against the question label. */
  match: string;
  /** Option labels in priority order: exact, then containment, then index 0. */
  picks: string[];
  /** Value for free-text inputs on the same step. Never an option label. */
  text?: string;
}

/** Values the bank can hold. Matches `Config["answers"]` from config.ts. */
export type AnswerBank = Record<string, string | string[] | number | boolean | undefined>;

/** `answers` keys exist both bare and `_v2`; first non-empty wins. */
function bankValue(bank: AnswerBank, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = bank[k];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return undefined;
}

/**
 * Salary label variants. Jobstreet/SEEK render the same number as
 * "Rp 7,000,000", "Rp 7.000.000", "Rp 7 million" or a bare "7000000",
 * so a rule that only knows one spelling silently falls through to index 0.
 */
function salaryVariants(n: number): string[] {
  const comma = n.toLocaleString("en-US");
  const dot = n.toLocaleString("id-ID");
  const out: string[] = [];
  // Jobstreet's own <select> renders "Rp 1 Jt", "Rp 1,5 Jt", ... "Rp 10 Jt".
  // Without the "Jt" spelling every salary rule missed and the site's stale
  // pre-fill (Rp 5 Jt) survived untouched.
  if (n % 100_000 === 0) {
    const m = n / 1_000_000;
    for (const s of [String(m), String(m).replace(".", ",")]) {
      out.push(`Rp ${s} Jt`, `Rp ${s}jt`, `Rp${s} Jt`, `${s} Jt`, `${s} juta`, `Rp ${s} juta`);
    }
  }
  if (n % 1_000_000 === 0) {
    const m = n / 1_000_000;
    out.push(`Rp ${m} million`, `Rp ${m} juta`, `${m} million`, `${m} juta`);
  }
  out.push(`Rp ${comma}`, `Rp${comma}`, `Rp ${dot}`, `IDR ${comma}`, comma, dot, String(n));
  return [...new Set(out)];
}

/** Turn a bank value into an option-label candidate list (+ optional text value). */
function picksOf(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "number") return [String(v), String(Math.round(v))];
  if (typeof v === "boolean") return [v ? "Yes" : "No", v ? "Ya" : "Tidak"];
  return [String(v)];
}

/**
 * Build the CV answer rules. Ordered most-specific first — `choose()` walks the
 * list in order and the first rule that matches the question wins.
 *
 * A rule with an empty `picks` is dropped, so a half-filled CV degrades to the
 * generic table instead of answering with nonsense.
 */
export function buildAnswerRules(bank: AnswerBank = {}): AnswerRule[] {
  const rules: AnswerRule[] = [];

  const add = (match: RegExp, picks: string[], text?: string) => {
    const clean = [...new Set(picks.map((p) => p.trim()).filter(Boolean))];
    const t = text?.trim();
    if (clean.length === 0 && !t) return;
    rules.push({ match: match.source, picks: clean, ...(t ? { text: t } : {}) });
  };

  // --- Salary ------------------------------------------------------------
  const expected = bankValue(bank, "expected_salary_idr", "expected_salary_v2", "expected_salary");
  if (typeof expected === "number" && expected > 0) {
    add(
      /expected monthly (basic )?salary|expected salary|ekspektasi gaji|gaji yang diharapkan|monthly salary|gaji bulanan|berapa gaji|gaji yang (kamu )?inginkan|penghasilan yang diharapkan|upah yang diharapkan/i,
      // Also keep the generic ladder so a coarser currency scale still matches.
      [...salaryVariants(expected), "Rp 5 million", "Rp 1 million"],
      String(expected)
    );
  }

  const current = bankValue(bank, "current_salary_idr", "current_salary");
  if (typeof current === "number" && current > 0) {
    add(/current (monthly )?salary|gaji saat ini|gaji sekarang/i, salaryVariants(current), String(current));
  }

  // --- Years of relevant experience --------------------------------------
  // Jobstreet asks this per-skill ("How many years experience in Full Stack
  // Java Development…", "Berapa tahun pengalaman kerjamu di bidang …"), so the
  // pattern must catch the KPI phrasing, not just "years of relevant".
  const years = bankValue(bank, "years_of_relevant_experience", "years_of_relevant_experience_v2");
  // Covers "How many years' experience do you have as a …" (apostrophe),
  // "Berapa tahun pengalaman kerjamu di bidang …" (reversed word order) and
  // the generic "years of relevant experience". Missing these three made the
  // years question fall through to the "No experience" under-claim guard.
  const yearsMatch =
    /years?['\u2019]?\s*(of\s+)?(relevant\s+)?experience|how many years|tahun\s+pengalaman|pengalaman\s+(kerja|kerjamu)?|berapa\s+(lama|tahun)\s+pengalaman/i;
  if (years !== undefined) {
    const base = picksOf(years);
    const expansions: string[] = [];
    for (const b of base) {
      expansions.push(b);
      const m = /^(more than|over|above)\s+(\d+)/i.exec(b);
      if (m) {
        const n = m[2];
        expansions.push(
          `${n}+ years`,
          `${n} years or more`,
          `${n}+ years of experience`,
          `More than ${n} years`,
          `Lebih dari ${n} tahun`,
          `${n} tahun atau lebih`,
          `${n}+ tahun`
        );
      }
    }
    // Also add the "N years" ladder so a coarser option set (3 / 5 / 10) still
    // lands on the highest rung we can honestly claim.
    expansions.push(
      "More than 5 years",
      "5+ years",
      "5 years or more",
      "Lebih dari 5 tahun",
      "3+ years",
      "3 years or more"
    );
    add(yearsMatch, expansions);
  }

  // --- Education ---------------------------------------------------------
  const education = bankValue(bank, "education_level", "education", "highest_education");
  if (education !== undefined) {
    const base = picksOf(education);
    const aliases: string[] = [];
    for (const b of base) {
      aliases.push(b);
      if (/bachelor|s1|sarjana/i.test(b)) {
        aliases.push(
          "Bachelor's Degree (S1)",
          "Bachelor Degree (S1)",
          "Bachelor's Degree",
          "Sarjana (S1)",
          "S1",
          "Sarjana"
        );
      }
      if (/diploma|d3/i.test(b)) aliases.push("Diploma 3", "D3");
    }
    add(/highest (level of )?education|educational (background|qualification)|qualifications? do you have|kualifikasi|pendidikan terakhir|ijazah/i, aliases);
  }

  // --- Notice period / availability --------------------------------------
  const notice = bankValue(bank, "notice_period", "availability");
  if (notice !== undefined) {
    add(
      /notice period|periode notice|how soon can you (start|join)|kapan.*(mulai|bergabung)|availability|ketersediaan/i,
      [...picksOf(notice), "Immediately available", "Immediately", "Segera", "2 weeks", "1 month"]
    );
  }

  // --- Right to work -----------------------------------------------------
  // Only speak up when the CV actually says where we live / what we hold. An
  // empty bank must emit nothing here — we never invent citizenship.
  const citizenship = bankValue(bank, "nationality", "citizenship", "right_to_work");
  const location = bankValue(bank, "domicile", "current_location");
  const inIndonesia = typeof location === "string" && /indonesia/i.test(location);
  // Jobstreet words this in Indonesian as "Pernyataan mana di bawah ini yang
  // paling mendeskripsikan hakmu bekerja di Indonesia?" — "hak untuk bekerja"
  // never appears, so the rule has to name "hakmu bekerja" / "izin tinggal".
  const rtwMatch =
    /right to work|work authori[sz]ation|legally (entitled|allowed) to work|hak untuk bekerja|hakmu bekerja|hak bekerja|deskripsikan hak|izin (kerja|tinggal)|kitas|kitap|warga negara/i;
  if (inIndonesia) {
    add(rtwMatch, [
      "Saya adalah warga negara Indonesia",
      "I'm an Indonesian citizen",
      "Indonesian citizen",
      "Saya memiliki izin Ketenagakerjaan/Kerja",
      "Saya memiliki izin tinggal Indonesia (KITAS/KITAP)",
      "I have an Indonesian residence permit (KITAS/KITAP)",
      ...picksOf(citizenship),
      "Yes",
    ]);
  } else if (citizenship !== undefined) {
    add(rtwMatch, picksOf(citizenship));
  }

  // --- Industry (checkbox group on /apply/role-requirements) --------------
  // "Which of these industries have you worked in?" has no direct CV field.
  // Derive it from the skill vocabulary: an IT skill list means an IT industry.
  const cvSkills = Array.isArray(bank.skills) ? bank.skills.map(String) : [];
  const itish = cvSkills.some((s) =>
    /php|javascript|typescript|node|python|java(?!script)|sql|docker|kubernetes|cloud|android|flutter|html|css|api|git|linux|devops|laravel|elastic/i.test(s)
  );
  if (itish) {
    add(/industr/i, [
      "Information Technology",
      "IT Services and IT Consulting",
      "Software Development",
      "Computer Software",
      "Information Technology and Services",
      "Technology, Information and Media",
    ]);
  }

  // --- Relocation --------------------------------------------------------
  const relocate = bankValue(bank, "willing_to_relocate");
  if (relocate !== undefined) {
    add(/willing to relocate|bersedia.*pindah|relocat/i, picksOf(relocate));
  }

  // --- Location ----------------------------------------------------------
  if (location !== undefined) {
    const base = picksOf(location);
    const aliases: string[] = [];
    for (const b of base) {
      aliases.push(b);
      const city = b.split(",")[0]?.trim();
      if (city && city !== b) aliases.push(city);
    }
    aliases.push("Indonesia", "Kalimantan Timur", "East Kalimantan");
    add(
      /current (location|city|address)|where (are you|do you) (currently )?(based|live)|domisili|lokasi (saat ini|anda)|tempat tinggal/i,
      aliases
    );
  }

  // --- Skill proficiency -------------------------------------------------
  const skill = bankValue(bank, "skill_set_tools", "skill_set_tools_v2", "proficiency", "skill_level");
  if (skill !== undefined) {
    add(
      /proficiency|skill level|tingkat keahlian|how (would you|do you) rate|level of (expertise|experience) (in|with)/i,
      [...picksOf(skill), "Expert", "Advanced", "Intermediate"]
    );
  }

  // --- Languages ---------------------------------------------------------
  const languages = bankValue(bank, "skill_set_foreign_language", "skill_set_foreign_language_v2", "languages");
  if (languages !== undefined) {
    add(/language|bahasa|fluen[ct]/i, [...picksOf(languages), "English", "Bahasa Indonesia"]);
  }

  // --- Work arrangement --------------------------------------------------
  const arrangement = bankValue(bank, "work_arrangement_preference");
  if (arrangement !== undefined) {
    const base = picksOf(arrangement);
    add(
      /work (arrangement|setup|mode)|remote|hybrid|on-?site|wfo|wfh|sistem kerja/i,
      [...base, "Remote", "Hybrid", "On-site", "Di kantor"]
    );
  }

  // --- Demographics (employer profiles do ask these) ---------------------
  const gender = bankValue(bank, "gender");
  if (gender !== undefined) {
    add(/gender|jenis kelamin/i, [...picksOf(gender), "Male", "Female", "Pria", "Wanita"]);
  }

  const dob = bankValue(bank, "date_of_birth");
  if (dob !== undefined) {
    add(/date of birth|tanggal lahir|birth ?date/i, picksOf(dob), String(dob));
  }

  return rules;
}

const PROFICIENCY_WORDS = new Set([
  "expert", "advanced", "intermediate", "beginner", "basic", "native", "fluent",
  "professional", "novice", "master", "conversational", "proficient", "none",
]);

const SPOKEN_LANGUAGES = new Set([
  "english", "indonesian", "bahasa indonesia", "mandarin", "japanese", "korean",
  "arabic", "spanish", "french", "german", "thai", "vietnamese", "hindi",
]);

/**
 * The CV's skill vocabulary, used to tick required multi-select questions like
 * "Library/framework back end apa saja di bawah ini yang bisa kamu gunakan?".
 *
 * Sourced from the skill-adjacent answer-bank fields plus any caller-supplied
 * hints (the operator's keyword filters already list their working stack).
 * Only names that appear in this vocabulary are ever ticked — nothing is
 * invented. Proficiency levels and spoken languages are excluded on purpose:
 * "Expert" and "English" are not framework names.
 */
export function buildSkillList(bank: AnswerBank = {}, hints: string[] = []): string[] {
  const out = new Set<string>();

  const push = (v: unknown) => {
    if (v === undefined || v === null) return;
    const items = Array.isArray(v) ? v : [v];
    for (const item of items) {
      const s = String(item).trim();
      if (s.length < 2 || s.length > 30) continue;
      if (/^https?:/i.test(s)) continue;
      if (/^\d+$/.test(s)) continue;
      // Filter on the trimmed word so "Bahasa Indonesia" survives here.
      if (PROFICIENCY_WORDS.has(s.toLowerCase())) continue;
      if (SPOKEN_LANGUAGES.has(s.toLowerCase())) continue;
      out.add(s);
    }
  };

  for (const k of Object.keys(bank)) {
    if (/^skill|^tools?$|^stack$|^technolog|^language/i.test(k)) push(bank[k]);
  }

  for (const h of hints) push(h);

  return [...out];
}

/** Collect job links from a listing page. */
export async function collectJobs(
  page: Page,
  keyword: string,
  cfg: JobstreetConfig,
  log: LogFn
): Promise<JobLink[]> {
  const found = new Map<string, JobLink>();

  for (let p = 1; p <= Math.max(1, cfg.maxPages); p++) {
    await gotoSearch(page, keyword, cfg.location, p);
    await sleep(jitter(1.2, 2.4));

    const pageLinks = (await safeEval(page, (selectors: string[]) => {
      const out: { url: string; title: string; company: string }[] = [];
      const seen = new Set<string>();
      for (const sel of selectors) {
        for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>(sel))) {
          const href = a.href;
          if (!href || !/\/job\//.test(href)) continue;
          const key = href.split("?")[0] ?? href;
          if (seen.has(key)) continue;
          seen.add(key);
          const card = a.closest<HTMLElement>('article, [data-automation^="job-item-"], div[data-card-type]');
          const titleEl = card?.querySelector<HTMLElement>(
            '[data-automation="jobTitle"], a[data-automation="job-list-item-link-overlay"]'
          );
          const companyEl = card?.querySelector<HTMLElement>('[data-automation="jobCompany"], [data-automation="advertiser-name"]');
          out.push({
            url: key,
            title: (titleEl?.textContent ?? a.textContent ?? "").trim().slice(0, 160),
            company: (companyEl?.textContent ?? "").trim().slice(0, 120),
          });
        }
      }
      return out;
    }, JOB_LINK_SELECTORS)) ?? [];

    if (pageLinks.length === 0) {
      log(`  page ${p}: no job cards (stopping pagination)`);
      break;
    }

    for (const l of pageLinks) {
      if (!found.has(l.url)) found.set(l.url, l);
      if (found.size >= cfg.maxJobsPerKeyword) break;
    }
    log(`  page ${p}: +${pageLinks.length} cards → ${found.size}/${cfg.maxJobsPerKeyword} unique`);
    if (found.size >= cfg.maxJobsPerKeyword) break;
  }

  return Array.from(found.values());
}

interface ApplyButtonHit {
  selector: string;
  text: string;
}

/** Find the first visible apply affordance on the current page. */
async function findApplyButton(page: Page): Promise<ApplyButtonHit | null> {
  const bySelector = await page.evaluate((selectors: string[]) => {
    for (const sel of selectors) {
      const el = Array.from(document.querySelectorAll<HTMLElement>(sel)).find(
        (e) => e.offsetParent !== null
      );
      if (el) return { selector: sel, text: (el.textContent ?? "").trim() };
    }
    return null;
  }, APPLY_TRIGGERS);
  if (bySelector) return bySelector;

  const byText = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('button, a[role="button"], a[href*="/apply"]')
    );
    for (const n of nodes) {
      if (n.offsetParent === null) continue;
      const t = (n.textContent ?? "").trim().toLowerCase();
      if (/^(lamar cepat|lamar sekarang|lamar|quick apply|apply now|apply)$/.test(t)) return t;
    }
    return null;
  });
  return byText ? { selector: "", text: byText } : null;
}

/** Click an element by selector or by visible text. */
async function clickApply(page: Page, hit: ApplyButtonHit): Promise<boolean> {
  if (hit.selector) {
    const els = await page.$$(hit.selector);
    for (const el of els) {
      const visible = await el.evaluate((n) => (n as HTMLElement).offsetParent !== null);
      if (!visible) continue;
      await el.click().catch(() => undefined);
      return true;
    }
    return false;
  }
  const clicked = await page.evaluate((text: string) => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('button, a[role="button"], a[href*="/apply"]')
    );
    for (const n of nodes) {
      if (n.offsetParent === null) continue;
      if ((n.textContent ?? "").trim().toLowerCase() === text) { n.click(); return true; }
    }
    return false;
  }, hit.text.toLowerCase());
  return clicked;
}

/** Read title/company from the job detail page. */
async function readDetail(page: Page): Promise<{ title: string; company: string }> {
  return page.evaluate(() => {
    const pick = (sels: string[]): string => {
      for (const s of sels) {
        const el = document.querySelector<HTMLElement>(s);
        const t = el?.textContent?.trim();
        if (t) return t;
      }
      return "";
    };
    return {
      title: pick(['[data-automation="job-detail-title"]', "h1"]).slice(0, 160),
      company: pick(['[data-automation="advertiser-name"]', '[data-automation="job-detail-company"]']).slice(0, 120),
    };
  });
}

/** True when the detail page says we've already applied. */
/**
 * True when the detail page says we've already applied. Deliberately narrow:
 * the apply wizard itself contains the word "dilamar" inside its step labels,
 * so a bare \b(dilamar|applied)\b over the whole body false-positives and the
 * bot skips jobs it never actually applied to.
 */
async function detailSaysApplied(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const strip = (s: string | null | undefined) =>
      (s ?? "").replace(/[\u2060\u200b\ufeff\u00a0]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    const badge = document.querySelector<HTMLElement>(
      '[data-automation="job-status-badge"], [data-testid="job-status-badge"]'
    );
    if (/^(applied|dilamar|sudah dilamar)$/.test(strip(badge?.textContent))) return true;
    const btn = document.querySelector<HTMLElement>('[data-automation="job-detail-apply"]');
    return /^(applied|dilamar|sudah dilamar)$/.test(strip(btn?.textContent));
  });
}

/**
 * Answer the current wizard step's screening questions.
 *
 * Jobstreet renders them as native <select> elements paired with a <label for>,
 * which is exactly what a real user manipulates — so setting `.value` and firing
 * `input` + `change` is enough. React's value tracker does not interfere with
 * native <select>, only with <input type=text>.
 */
async function answerQuestions(
  page: Page,
  log: LogFn,
  cvRules: AnswerRule[] = [],
  cvSkills: string[] = []
): Promise<{ filled: number; unanswered: string[] }> {
  // CV rules go FIRST: `choose()` walks the list in order and the first rule
  // that matches the question wins, so the real answer beats the generic guess.
  const rules = [
    ...cvRules,
    ...QUESTION_FALLBACKS.map((f) => ({ match: f.match.source, picks: f.picks })),
  ];

  const res = await safeEval(
    page,
    (input: { rules: { match: string; picks: string[]; text?: string }[]; skills: string[] }) => {
      const rules = input.rules; // never spread `input` — safeEval passes one argument
      const skills = input.skills;
      const strip = (s: string | null | undefined) =>
        (s ?? "").replace(/[\u2060\u200b\ufeff\u00a0]/g, "").replace(/\s+/g, " ").trim();
      const norm = (s: string) => strip(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

      const filled: string[] = [];
      const unanswered: string[] = [];

      const matchingRules = (question: string) =>
        rules.filter((r) => {
          try {
            return new RegExp(r.match, "i").test(question);
          } catch {
            return false;
          }
        });

      /** "Other / not listed" catch-alls force a free-text follow-up — avoid. */
      const isCatchAll = (l: string) => /^(other|others|not listed|lainnya|lain-lain)/i.test(strip(l));

      /**
       * "None of the above" options. Ticking one is a truthful answer when the CV
       * lists nothing from the offered set, and it still satisfies a required
       * multi-select — unlike leaving the group empty, which blocks the wizard.
       */
      const isNoneOption = (l: string) =>
        /^(none of the above|none|no experience|not applicable|n\/a|tidak satupun|tidak ada satu ?pun|tidak ada yang|tidak ada)/i.test(
          strip(l)
        );

      /** Real, answerable option (not a catch-all and not a "none" escape). */
      const isRealOption = (l: string) =>
        norm(l) !== "" && !isCatchAll(l) && !isNoneOption(l);

      /**
       * Jobstreet renders its own radios/checkboxes: there is no <label> wrapper,
       * the <legend> is empty and `value` is "on", so `closest("label")` returns
       * null and every option used to resolve to the literal string "on".
       * The visible text lives in a nested <div>/<span> sibling, so walk up from
       * the input to the first ancestor that carries text and stop at the first
       * ancestor that holds a SIBLING option (that one is the group).
       */
      const optionText = (input: HTMLElement): string => {
        let el: HTMLElement | null = input.parentElement;
        for (let d = 0; d < 8 && el; d++) {
          const t = strip(el.textContent ?? "");
          if (t) return t;
          el = el.parentElement;
        }
        return "";
      };

      /**
       * The group question is stored as a text prefix, not in a <legend>:
       * container.textContent === question + option1 + option2 + …  so strip the
       * option texts off the front-trimmed string.
       */
      const groupQuestion = (inputs: HTMLInputElement[], labels: string[]): string => {
        let el: HTMLElement | null = inputs[0]?.parentElement ?? null;
        for (let d = 0; d < 12 && el; d++) {
          const t = strip(el.textContent ?? "");
          // Narrow enough to still contain the whole prompt but not the page.
          if (t.length > 8 && t.length <= 900) {
            let q = t;
            for (const l of labels) {
              if (!l) continue;
              const at = q.indexOf(l);
              if (at >= 0) q = (q.slice(0, at) + " " + q.slice(at + l.length)).trim();
            }
            q = q.replace(/\s+/g, " ").trim();
            if (q.length >= 8) return q.slice(0, 190);
          }
          el = el.parentElement;
        }
        return strip(
          inputs[0]?.getAttribute("aria-label") ??
            inputs[0]?.closest("[aria-label]")?.getAttribute("aria-label") ??
            inputs[0]?.name ??
            ""
        ).slice(0, 190);
      };

      const choose = (labels: string[], question: string): number => {
        const hits = matchingRules(question);

        // 1. exact label match, in rule order then pick order
        for (const r of hits) {
          for (const wanted of r.picks) {
            const nw = norm(wanted);
            const i = labels.findIndex((l) => norm(l) === nw);
            if (i >= 0) return i;
          }
        }
        // 2. containment — options often wrap the label in extra words
        for (const r of hits) {
          for (const wanted of r.picks) {
            const nw = norm(wanted);
            if (nw.length < 4) continue;
            const i = labels.findIndex((l) => norm(l).includes(nw));
            if (i >= 0) return i;
          }
        }
        // 3. Never claim seniority we don't have (only if the CV said nothing).
        if (hits.length === 0 && /years?.*experience|pengalaman/i.test(question)) {
          for (const want of [/^no experience/i, /less than 1 year/i, /^1 year/i]) {
            const i = labels.findIndex((l) => want.test(strip(l)));
            if (i >= 0) return i;
          }
        }
        // 4. Last resort: first real, non-catch-all option, so the wizard advances.
        const firstReal = labels.findIndex(isRealOption);
        return firstReal >= 0 ? firstReal : 0;
      };

      /**
       * Options named directly by a CV rule's `picks`, for multi-select groups
       * that the skill vocabulary can't cover (industries, benefits, …).
       */
      const rulePicks = (question: string, labels: string[]): number[] => {
        const hits = matchingRules(question);
        if (hits.length === 0) return [];
        const out: number[] = [];
        for (const r of hits) {
          for (const w of r.picks) {
            const nw = norm(w);
            if (nw.length < 4) continue;
            const exact = labels.findIndex((l) => norm(l) === nw);
            const i = exact >= 0 ? exact : labels.findIndex((l) => norm(l).includes(nw));
            if (i >= 0 && isRealOption(labels[i] ?? "") && !out.includes(i)) out.push(i);
          }
        }
        return out;
      };

      /**
       * Which checkboxes to tick for a multi-select screening question.
       * Tier 1 is the CV's skill vocabulary; tiers 2-4 are the caller's job, so
       * this stays a pure matcher (it never invents a tick of its own).
       */
      const wantedSkills = (question: string, labels: string[], cvSkills: string[]): number[] => {
        const qn = norm(question);
        const isSkillQuestion =
          /skills?|library|framework|tools?|technology|technologies|stack|bahasa|language|technical/i.test(question) ||
          cvSkills.some((s) => qn.includes(norm(s)));
        if (!isSkillQuestion) return [];

        const out: number[] = [];
        // Word-boundary matching on the normalised (space-separated) strings.
        // Plain `includes` gave false positives: needle "git" matched
        // "Digital Marketing", and "java" matched "JavaScript".
        const wordHit = (needle: string, hay: string): boolean => {
          if (needle.length < 2 || hay.length < 2) return false;
          const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return new RegExp(`(^| )${esc}( |$)`).test(hay) || new RegExp(`(^| )${hay.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(needle);
        };
        for (let i = 0; i < labels.length; i++) {
          const ln = norm(labels[i] ?? "");
          if (!ln) continue;
          if (isCatchAll(labels[i] ?? "")) continue;
          if (cvSkills.some((s) => wordHit(norm(s), ln))) {
            out.push(i);
          }
        }
        return out;
      };

      /**
       * Full fallback chain for a required multi-select group. A required group
       * left empty blocks "Lanjut" with a validation banner, so every tier exists
       * to reach a defensible answer rather than a dead end.
       */
      const wantedBoxes = (question: string, labels: string[], cvSkills: string[]): number[] => {
        const skillsHit = wantedSkills(question, labels, cvSkills);
        if (skillsHit.length > 0) return skillsHit;

        const named = rulePicks(question, labels);
        if (named.length > 0) return named;

        // Nothing from the CV is on offer — say so truthfully if the list allows.
        const none = labels.findIndex((l) => isNoneOption(l));
        if (none >= 0) return [none];

        // Short list with no escape hatch: tick one real option so the group is
        // not empty. A long "select all that apply" is left to a human instead.
        if (labels.length > 0 && labels.length <= 12) {
          const firstReal = labels.findIndex(isRealOption);
          if (firstReal >= 0) return [firstReal];
        }
        return [];
      };

      /** React tracks <input> values; go through the native setter then fire events. */
      const setNativeValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
        const proto =
          el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
      };

      // ---- native <select> (the common case on /apply/role-requirements) ----
      for (const sel of Array.from(document.querySelectorAll<HTMLSelectElement>("select"))) {
        if (!sel.offsetParent) continue;
        const labelEl =
          (sel.id && document.querySelector<HTMLLabelElement>(`label[for="${sel.id}"]`)) ||
          sel.closest<HTMLElement>("div, fieldset")?.querySelector<HTMLElement>("label, legend");
        const question = strip(labelEl?.textContent ?? sel.name ?? "").slice(0, 190);
        if (!question) continue;

        const opts = Array.from(sel.options).filter((o) => o.value !== "");
        if (opts.length === 0) continue;

        const labels = opts.map((o) => strip(o.textContent));
        const idx = choose(labels, question);
        const chosen = opts[idx];
        if (!chosen) { unanswered.push(question); continue; }

        const chosenLabel = labels[idx] ?? "";
        const currentLabel = sel.selectedIndex > 0 ? strip(opts[sel.selectedIndex - 1]?.textContent ?? "") : "";
        const hits = matchingRules(question);

        // Jobstreet pre-fills some selects with a stale saved answer
        // ("Berapa gaji bulanan…" came back as "Rp 5 Jt"). Skipping every select
        // that already had a value left those defaults untouched, so an answer
        // is only kept when it already equals what the CV says, or when no CV
        // rule matched at all (then the pre-fill is better than our guess).
        if (currentLabel && norm(currentLabel) === norm(chosenLabel)) continue;
        if (currentLabel && hits.length === 0) continue;

        sel.value = chosen.value;
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        filled.push(
          `${question.slice(0, 80)} → ${chosenLabel}${currentLabel ? ` (was ${currentLabel})` : ""}`
        );
      }

      // ---- checkbox groups (required multi-select screening questions) ----
      // "Library/framework back end apa saja di bawah ini yang bisa kamu
      // gunakan?" is a required checkbox group: leaving it empty blocks Lanjut
      // with a validation banner. Tick every option the CV’s skill list names.
      const cbGroups = new Map<string, HTMLInputElement[]>();
      for (const cb of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
        if (!cb.offsetParent) continue;
        // Jobstreet leaves `name` empty and keys the group on the input id prefix
        // (ID_Q_137_V_1_A_756 …) — grouping on `name` found nothing at all.
        const key = cb.name || cb.id.replace(/_A_?\d+$/, "") || cb.id;
        if (!key) continue;
        if (/document-select/i.test(key)) continue;
        const arr = cbGroups.get(key) ?? [];
        arr.push(cb);
        cbGroups.set(key, arr);
      }
      for (const [name, boxes] of cbGroups) {
        // A group already holding a tick was answered in an earlier pass.
        if (boxes.some((b) => b.checked)) continue;
        const labels = boxes.map((b) => optionText(b));
        const question = groupQuestion(boxes, labels);
        const wanted = wantedBoxes(question, labels, skills);
        if (wanted.length === 0) { unanswered.push(question || name); continue; }
        for (const i of wanted) {
          boxes[i]?.click();
          filled.push(`${question.slice(0, 80)} → ${labels[i]}`);
        }
      }

      // ---- radio groups (skip the document/cover-letter selectors) ----
      const groups = new Map<string, HTMLInputElement[]>();
      for (const r of Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]'))) {
        if (!r.offsetParent) continue;
        const key = r.name || r.id.replace(/_A_?\d+$/, "") || r.id;
        if (!key) continue;
        if (/document-select|coverLetter-method/i.test(key)) continue;
        const arr = groups.get(key) ?? [];
        arr.push(r);
        groups.set(key, arr);
      }
      for (const [name, radios] of groups) {
        if (radios.some((r) => r.checked)) continue;
        const labels = radios.map((r) => optionText(r));
        const question = groupQuestion(radios, labels);
        const target = radios[choose(labels, question)];
        if (!target) { unanswered.push(question || name); continue; }
        target.click();
        filled.push(`${question.slice(0, 80)} → ${labels[radios.indexOf(target)]}`);
      }

      // ---- free-text inputs the CV can actually fill (salary, DOB, links) ----
      const TEXT_TYPES = new Set(["text", "number", "tel", "url", "email", ""]);
      for (const el of Array.from(
        document.querySelectorAll<HTMLInputElement>("input, textarea")
      )) {
        if (!el.offsetParent) continue;
        if (el instanceof HTMLInputElement && !TEXT_TYPES.has(el.type)) continue;
        if (el.disabled || el.readOnly) continue;
        if ((el.value ?? "").trim() !== "") continue;
        const labelEl =
          (el.id && document.querySelector<HTMLLabelElement>(`label[for="${el.id}"]`)) ||
          el.closest<HTMLElement>("div, fieldset")?.querySelector<HTMLElement>("label, legend");
        const question = strip(
          labelEl?.textContent ?? el.getAttribute("aria-label") ?? el.name ?? ""
        ).slice(0, 190);
        if (!question) continue;
        const rule = matchingRules(question).find((r) => (r.text ?? "").trim() !== "");
        const value = (rule?.text ?? "").trim();
        if (!value) continue;
        setNativeValue(el, value);
        filled.push(`${question.slice(0, 80)} → ${value}`);
      }

      return { filled, unanswered };
    },
    { rules, skills: cvSkills }
  );

  if (!res) return { filled: 0, unanswered: [] };
  for (const f of res.filled) log(`    A: ${f}`);
  return { filled: res.filled.length, unanswered: res.unanswered };
}

/** Read Jobstreet's blocking validation banner, if any. */
async function readValidation(page: Page): Promise<string[]> {
  const out = await safeEval(page, (sel: string) => {
    const strip = (s: string | null | undefined) =>
      (s ?? "").replace(/[\u2060\u200b\ufeff\u00a0]/g, "").replace(/\s+/g, " ").trim();
    return Array.from(document.querySelectorAll<HTMLElement>(sel))
      .map((e) => strip(e.textContent))
      .filter((t) => t.length > 0)
      .slice(0, 4);
  }, VALIDATION_SELECTOR);
  return out ?? [];
}

/** True when a real submit CTA is on screen — never the "Review dan kirim" step nav. */
async function findSubmit(page: Page): Promise<boolean> {
  return (
    (await safeEval(page, (sels: string[]) => {
      for (const s of sels) {
        if (Array.from(document.querySelectorAll<HTMLElement>(s)).some((e) => e.offsetParent !== null)) return true;
      }
      return false;
    }, SUBMIT_SELECTORS)) ?? false
  );
}

/** Click the wizard's advance control. Returns the button label, or null if absent. */
async function clickContinue(page: Page): Promise<string | null> {
  return safeEval(page, (sel: string) => {
    const strip = (s: string | null | undefined) =>
      (s ?? "").replace(/[\u2060\u200b\ufeff\u00a0]/g, "").replace(/\s+/g, " ").trim();
    const btn = document.querySelector<HTMLElement>(sel);
    if (!btn || !btn.offsetParent) return null;
    const label = strip(btn.textContent);
    btn.click();
    return label;
  }, CONTINUE_SELECTOR);
}

/**
 * Drive Jobstreet's apply wizard to the submit step.
 *
 * The flow is a routed multi-step SPA under /id/job/<id>/apply:
 *   Pilih dokumen → Jawab pertanyaan perusahaan → Perbarui Profil Jobstreet → Review dan kirim
 * Every step advances through the same [data-testid="continue-button"] ("Lanjut").
 * `Jawab pertanyaan perusahaan` renders required <select>s; if they are left empty
 * "Lanjut" silently no-ops and Jobstreet re-renders its validation banner instead
 * of navigating — so we answer first and verify by URL change, not by a click.
 */
async function walkQuestionnaire(
  page: Page,
  maxSteps: number,
  log: LogFn,
  cvRules: AnswerRule[] = [],
  cvSkills: string[] = []
): Promise<"ready" | "stuck"> {
  for (let step = 1; step <= maxSteps; step++) {
    await sleep(jitter(0.9, 1.8));

    if (await findSubmit(page)) {
      log(`  step ${step}: submit CTA detected`);
      return "ready";
    }

    await answerQuestions(page, log, cvRules, cvSkills);

    const before = await page.evaluate(() => location.href);
    const label = await clickContinue(page);

    if (label === null) {
      log(`  step ${step}: no continue control on ${before}`);
      return "stuck";
    }

    await sleep(jitter(1.4, 2.6));

    const after = await page.evaluate(() => location.href);
    const problems = await readValidation(page);

    if (after === before && problems.length > 0) {
      log(`  step ${step}: blocked — "${(problems[0] ?? "").slice(0, 160)}"`);
      const fixed = await answerQuestions(page, log, cvRules, cvSkills);
      if (fixed.filled === 0 && fixed.unanswered.length === 0) {
        log(`  step ${step}: nothing left to answer, cannot advance`);
        return "stuck";
      }
      await clickContinue(page);
      await sleep(jitter(1.6, 2.8));
      const still = await readValidation(page);
      if (still.length > 0 && still[0] === problems[0]) {
        log(`  step ${step}: still blocked — "${(still[0] ?? "").slice(0, 160)}"`);
        return "stuck";
      }
      log(`  step ${step}: advanced after answering ("${label}")`);
      continue;
    }

    log(`  step ${step}: "${label}" → /${after.split("/id/")[1] ?? after}`);
  }

  return (await findSubmit(page)) ? "ready" : "stuck";
}

/** Press the real submit CTA. Returns true on click success. */
async function pressSubmit(page: Page): Promise<boolean> {
  const bySelector = await safeEval(page, (sels: string[]) => {
    for (const s of sels) {
      const el = Array.from(document.querySelectorAll<HTMLElement>(s)).find((e) => e.offsetParent !== null);
      if (el) { el.click(); return s; }
    }
    return null;
  }, SUBMIT_SELECTORS);
  if (bySelector) return true;

  return (
    (await safeEval(page, (re: string) => {
      const rx = new RegExp(re, "i");
      const strip = (s: string | null | undefined) =>
        (s ?? "").replace(/[\u2060\u200b\ufeff\u00a0]/g, "").replace(/\s+/g, " ").trim();
      const btn = Array.from(document.querySelectorAll<HTMLElement>("button")).find(
        (b) => b.offsetParent !== null && rx.test(strip(b.textContent))
      );
      if (!btn) return false;
      btn.click();
      return true;
    }, SUBMIT_TEXT.source)) ?? false
  );
}

/** Apply to one job. Never throws — returns an outcome. */
export async function applyToJob(
  page: Page,
  link: JobLink,
  cfg: JobstreetConfig,
  dryRun: boolean,
  log: LogFn,
  cvRules: AnswerRule[] = [],
  cvSkills: string[] = []
): Promise<ApplyOutcome> {
  let title = link.title;
  let company = link.company;

  try {
    await page.goto(link.url, { waitUntil: "domcontentloaded" });
    await sleep(jitter(1.0, 2.0));

    if (!(await isLoggedIn(page))) {
      return { status: "FAILED", reason: "AUTH_REQUIRED", title, company };
    }

    const detail = await readDetail(page);
    title = detail.title || title;
    company = detail.company || company;

    if (await detailSaysApplied(page)) {
      return { status: "SKIPPED", reason: "ALREADY_APPLIED", title, company };
    }

    const hit = await findApplyButton(page);
    if (!hit) {
      return { status: "SKIPPED", reason: "NO_APPLY_BUTTON", title, company };
    }
    if (EXTERNAL_APPLY.test(hit.text)) {
      return { status: "SKIPPED", reason: "EXTERNAL_APPLY", title, company };
    }
    if (ALREADY_APPLIED.test(hit.text)) {
      return { status: "SKIPPED", reason: "ALREADY_APPLIED", title, company };
    }

    if (!(await clickApply(page, hit))) {
      return { status: "FAILED", reason: "CLICK_FAILED", title, company };
    }
    await sleep(jitter(1.5, 3.0));

    // The apply flow can open a modal or navigate — either way, walk it.
    const stage = await walkQuestionnaire(page, 5, log, cvRules, cvSkills);
    if (stage === "stuck") {
      return { status: "FAILED", reason: "FLOW_STUCK", title, company };
    }

    if (dryRun) {
      log(`  DRY-RUN: reached submit step for "${title}"`);
      return { status: "DRY_RUN", title, company };
    }

    if (!(await pressSubmit(page))) {
      return { status: "FAILED", reason: "SUBMIT_NOT_FOUND", title, company };
    }
    await sleep(jitter(2.0, 3.5));

    // The click is the application; text only grades our confidence in it, so the
    // check must never downgrade or fail the outcome. It sweeps two sources:
    //   1. body text — normalises U+2060/U+200B before matching, and accepts the
    //      Indonesian wording Jobstreet actually renders;
    //   2. the live URL — /apply → /applied is an unambiguous success signal.
    // "not confirmed" alone is never a failure: it just means we found no signal.
    const confirmed = await page.evaluate(() => {
      const normalize = (s: string) =>
        (s || "").replace(/[\u2060\u200b\ufeff\u00a0]/g, "").replace(/\s+/g, " ").toLowerCase();
      const text = normalize(document.body.innerText);
      const url = location.href.toLowerCase();
      if (/applied|application-confirmation|lamaran-terkirim/.test(url) && !/\/apply(\/|$)/.test(url)) {
        return true;
      }
      return /(application submitted|application sent|successfully applied|you have (successfully )?applied|your application has been submitted|you ve applied|you have applied|lamaran (anda )?(telah|sudah) (di)?kirim|aplikasi terkirim|berhasil melamar|lamaran terkirim|lamaranmu sudah terkirim|telah melamar)/.test(text);
    });
    return confirmed
      ? { status: "SUBMITTED", title, company }
      : { status: "SUBMITTED", reason: "UNCONFIRMED_TEXT", title, company };
  } catch (e) {
    return { status: "FAILED", reason: (e as Error).message.slice(0, 120), title, company };
  }
}

/**
 * Pull applied-job cards from my-activity for status sync.
 *
 * Jobstreet's applied-jobs list is a div grid (`div[data-automation^="job-item-N"]`)
 * with NO anchors. Structure per card:
 *   - <h4> contains: "Posisi Pekerjaan <title>" (label span + title span)
 *   - a span after "Perusahaan" label holds the company name
 *   - leading card text may include status keywords: "Berakhir" (expired),
 *     "Sangat Berminat" (strong interest), "Dilamar di Jobstreet" (plain applied)
 *   - card has no URL → stable key = slug(title) + "|" + slug(company)
 * Pagination is JS-driven ("Go to page N" buttons) — use gotoApplied's ?page= URL,
 * which the SPA honors.
 */
export async function readAppliedJobs(
  page: Page,
  maxPages = 3
): Promise<{ url: string; status: string; title: string; company: string }[]> {
  const out: { url: string; status: string; title: string; company: string }[] = [];
  const seen = new Set<string>();

  const STATUS_TEXT: { re: RegExp; status: string }[] = [
    { re: /^berakhir/i, status: "EXPIRED" },
    { re: /ditolak|rejected/i, status: "REJECTED" },
    { re: /diwawancara|interview(ed)?/i, status: "INTERVIEW" },
    { re: /shortlisted|dipilih/i, status: "SHORTLISTED" },
    { re: /ditinjau|under review|in review/i, status: "REVIEW" },
    { re: /dilamar|applied/i, status: "APPLIED" },
    { re: /sangat berminat/i, status: "STRONG_INTEREST" },
  ];

  for (let p = 1; p <= maxPages; p++) {
    await gotoApplied(page, p);

    const cards = await safeEval(page, () => {
      const pick = (root: HTMLElement): { title: string; company: string } => {
        let title = "";
        let company = "";

        // <h4><span><span>Posisi Pekerjaan </span></span>TITLE</h4>
        const h4 = root.querySelector("h4");
        if (h4) {
          title = (h4.textContent || "")
            .replace(/\s+/g, " ")
            .replace(/^\s*Posisi Pekerjaan\s*/i, "")
            .replace(/^\s*Job\s*(title|position)\s*/i, "")
            .trim();
        }

        // <span><span>Perusahaan </span></span>COMPANY
        for (const s of Array.from(root.querySelectorAll("span"))) {
          const t = (s.textContent || "").replace(/\s+/g, " ").trim();
          if (/^Perusahaan\s+\S/i.test(t) || /^Company\s+\S/i.test(t)) {
            company = t.replace(/^(Perusahaan|Company)\s+/i, "").trim();
            break;
          }
        }

        // Fallback: cut on the label that follows the company name.
        if (!company) {
          const m = (root.textContent || "")
            .replace(/\s+/g, " ")
            .match(/(?:Perusahaan|Company)\s+(.{2,120}?)(?=\s*(?:Lokasi|Location|Rp|\$|Dilamar|Berakhir|Telah|Berakhir)\b|$)/i);
          company = m?.[1]?.trim() ?? "";
        }

        return { title, company };
      };

      const rows: { url: string; status: string; title: string; company: string; text: string }[] = [];
      const containers = Array.from(
        document.querySelectorAll<HTMLElement>('div[data-automation^="job-item-"]')
      );
      for (const c of containers) {
        if (!c.querySelector("h4") && !c.textContent?.includes("Posisi Pekerjaan")) continue;
        const { title, company } = pick(c);
        if (!title) continue;
        const text = (c.textContent || "").replace(/\s+/g, " ").trim();
        rows.push({
          url: `${title}::${company}`.toLowerCase().replace(/\s+/g, "-"),
          status: "",
          title,
          company,
          text,
        });
      }
      return rows;
    });

    if (!cards || cards.length === 0) break;

    let added = 0;
    for (const c of cards) {
      if (seen.has(c.url)) continue;
      // Derive status from leading card text.
      let status = "";
      for (const { re, status: s } of STATUS_TEXT) {
        if (re.test(c.text)) {
          status = s;
          break;
        }
      }
      seen.add(c.url);
      out.push({ url: c.url, status, title: c.title, company: c.company });
      added++;
    }
    if (added === 0) break;
  }

  return out;
}

export { BASE } from "./types.js";
