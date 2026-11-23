import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import { closeBrowser, launchBrowser, preparePage, sleep, jitter } from "./browser.js";
import { applyToJob, buildAnswerRules, buildSkillList, collectJobs, readAppliedJobs } from "./bot.js";
import type { AnswerBank, AnswerRule } from "./bot.js";
import type { JobLink, JobstreetConfig, LogFn } from "./types.js";
import { BASE, isLoggedIn, LOGIN_URL } from "./types.js";
import { JobstreetHistory } from "../storage.js";
import { deriveJobstreetConfig, slugLocation } from "./auto-keywords.js";
import type { KeywordOptions } from "../auto-keywords.js";

const KEYWORD_CACHE = ".glints/jobstreet-keywords.json";

interface KeywordCache {
  /** Derived keywords from the last derivation. */
  keywords: string[];
  /** Location from the last derivation. */
  location: string;
  /** How many apply runs have consumed this cache. */
  runs: number;
  updatedAt: string;
}

export class JobstreetBot {
  constructor(
    private cfg: JobstreetConfig,
    private timezone?: string,
    private log: LogFn = console.log,
    private keywordOptions: KeywordOptions = {},
    private includeHints: string[] = [],
    private excludeHints: string[] = [],
    private answerBank: AnswerBank = {}
  ) {}

  /**
   * Answer rules derived from the CV (config.json → answers). Built lazily on
   * first use — TypeScript runs field initializers before constructor parameter
   * properties, so `answerBank` is not yet assigned at declaration time. Reused
   * across every wizard step of every job, so /apply/role-requirements is
   * answered from the CV rather than the generic QUESTION_FALLBACKS guess table.
   */
  private cvRulesCache?: AnswerRule[];
  private get cvRules(): AnswerRule[] {
    return (this.cvRulesCache ??= buildAnswerRules(this.answerBank));
  }

  /**
   * The CV's skill vocabulary, used to tick required multi-select questions
   * ("Library/framework back end apa saja di bawah ini yang bisa kamu
   * gunakan?"). Nothing outside this list is ever ticked.
   */
  private cvSkillsCache?: string[];
  private get cvSkills(): string[] {
    return (this.cvSkillsCache ??= buildSkillList(this.answerBank, [
      ...this.includeHints,
      ...(this.cfg.searchKeywords ?? []),
    ]));
  }

  private history = new JobstreetHistory();

  /**
   * Daily cap. `config.ts` fills `jobstreet.limitPerDay` from the shared
   * `limits.maxAppliesPerDay` when config.json does not override it, so this is
   * one number for both boards.
   */
  private get cap(): number {
    return this.cfg.limitPerDay ?? 500;
  }

  /** Cap used for reporting/dispatch — exposed so the CLI can print one number. */
  get dailyCap(): number {
    return this.cap;
  }

  /**
   * Resolve the search plan (keywords + location) for this run.
   *
   * - `autoKeywords: false` → trust `cfg.searchKeywords` / `cfg.location` verbatim.
   * - `autoKeywords: true` → derive from applied history + `filters.includeKeywords`,
   *   respecting `excludeKeywords`, then fall back to the configured list.
   * - An empty configured list always triggers derivation, regardless of the flag.
   *
   * Location precedence: `locationOverride` / `JOBSTREET_LOCATION` → derived from
   * history → configured `location` (fallback) → answer-bank domicile → `"jakarta"`.
   * `searchKeywords` are ignored while `autoKeywords` is true (or empty).
   */
  private resolveSearchPlan(): { keywords: string[]; location: string } {
    const cfg = this.cfg;
    const configured = (cfg.searchKeywords ?? []).map((k) => k.trim()).filter(Boolean);
    const shouldAuto = cfg.autoKeywords === true || configured.length === 0;
    const override = (cfg.locationOverride ?? "").trim();
    const configuredLocation = (cfg.location ?? "").trim();
    const domicile =
      typeof this.answerBank["domicile"] === "string" ? (this.answerBank["domicile"] as string) : undefined;

    // Explicit location wins immediately — no derivation needed for it.
    const lockedLocation = slugLocation(override || configuredLocation);

    if (!shouldAuto) {
      return {
        keywords: configured.length > 0 ? configured : ["developer"],
        location: lockedLocation || "jakarta",
      };
    }

    // The configured location is a *fallback*, not a lock: derivation may still
    // override it with what history actually shows. `locationOverride` is the lock.
    const interval = cfg.refreshKeywordsEvery ?? 0;
    const cached = this.readKeywordCache();
    const refresh = this.shouldRefresh(interval, cached);

    let derived: ReturnType<typeof deriveJobstreetConfig>;
    if (!refresh && cached) {
      derived = {
        keywords: cached.keywords,
        location: cached.location || slugLocation(configuredLocation) || "jakarta",
        source: { history: this.history.all().length, config: 0, excluded: 0 },
      };
      this.log(chalk.dim(`keywords (cached): ${derived.keywords.join(", ")}  [runs ${cached.runs}/${interval}]`));
      this.log(chalk.dim(`location (cached): ${derived.location}`));
    } else {
      derived = deriveJobstreetConfig({
        mode: this.keywordOptions.mode,
        customTokens: this.keywordOptions.customTokens,
        extraRoleNouns: this.keywordOptions.extraRoleNouns,
        includeHints: this.includeHints,
        excludeKeywords: this.excludeHints,
        explicitLocation: override || (process.env.JOBSTREET_LOCATION ?? "").trim(),
        fallbackLocation: configuredLocation,
        domicile,
        max: cfg.maxAutoKeywords ?? 12,
      });
      this.writeKeywordCache(derived.keywords, derived.location, 0);
      this.log(
        chalk.dim(
          `keywords (auto): ${derived.keywords.length > 0 ? derived.keywords.join(", ") : "(none)"}` +
            `  [history ${derived.source.history}, hints ${derived.source.config}, excluded ${derived.source.excluded}]`
        )
      );
      this.log(chalk.dim(`location (auto): ${derived.location}`));
    }

    const keywords = derived.keywords.length > 0 ? derived.keywords : configured;

    return {
      keywords: keywords.length > 0 ? keywords : ["developer"],
      location: derived.location,
    };
  }

  /** Read the keyword cache, if any. Never throws. */
  private readKeywordCache(): KeywordCache | undefined {
    try {
      const raw = fs.readFileSync(path.resolve(process.cwd(), KEYWORD_CACHE), "utf8");
      const parsed = JSON.parse(raw) as Partial<KeywordCache>;
      if (!Array.isArray(parsed.keywords) || parsed.keywords.length === 0) return undefined;
      return {
        keywords: parsed.keywords.filter((k): k is string => typeof k === "string"),
        location: typeof parsed.location === "string" ? parsed.location : "",
        runs: typeof parsed.runs === "number" ? parsed.runs : 0,
        updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      };
    } catch {
      return undefined;
    }
  }

  /** Persist the derivation so `refreshKeywordsEvery > 0` can reuse it. Never throws. */
  private writeKeywordCache(keywords: string[], location: string, runs: number): void {
    try {
      const file = path.resolve(process.cwd(), KEYWORD_CACHE);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const payload: KeywordCache = { keywords, location, runs, updatedAt: new Date().toISOString() };
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
    } catch (e) {
      this.log(chalk.dim(`keyword cache write skipped: ${(e as Error).message}`));
    }
  }

  /** True when the derived plan should be recomputed this run. */
  private shouldRefresh(interval: number, cached: KeywordCache | undefined): boolean {
    if (!cached) return true;
    if (interval <= 0) return true; // 0 = every run
    return cached.runs >= interval;
  }

  /** Open a headful browser at the sign-in page; user solves captcha/2FA once. */
  async login(): Promise<void> {
    const browser = await launchBrowser({ headful: true });
    const page = await preparePage(browser);
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60_000 }).catch(() => undefined);
    this.log(chalk.yellow(`Login window open at ${LOGIN_URL}`));
    this.log(chalk.dim("Complete sign-in (email/password + captcha/2FA) in the browser window."));
    this.log(chalk.dim("The session cookie is saved in .glints/jobstreet-profile — this is one-time."));
    // Wait up to 10 minutes. Any successful sign-in ends on a non-oauth page
    // with an authenticated marker, so verify by navigating to the profile.
    for (let i = 0; i < 120; i++) {
      await sleep(5_000);
      try {
        const url = page.url();
        const onAuthApp = /oauth\/login|authorize/i.test(url);
        if (!onAuthApp) {
          const here = await isLoggedIn(page);
          if (here) {
            this.log(chalk.green("Login detected. Session saved."));
            await closeBrowser();
            return;
          }
          // Silent probe: hop to a member page in the same profile jar.
          const probe = await browser.newPage();
          await probe.goto(`${BASE}/id/my-activity/applied-jobs`, {
            waitUntil: "domcontentloaded",
            timeout: 30_000,
          }).catch(() => undefined);
          const ok = await isLoggedIn(probe).catch(() => false);
          await probe.close().catch(() => undefined);
          if (ok) {
            this.log(chalk.green("Login detected. Session saved."));
            await closeBrowser();
            return;
          }
        }
      } catch {
        // page may be mid-navigation — keep polling
      }
    }
    await closeBrowser();
    throw new Error("Login timeout — no authenticated state detected in 10 minutes.");
  }

  /** Main apply pass. Returns how many actually submitted. */
  async runApply(dryRun: boolean): Promise<number> {
    const cfg = this.cfg;
    const tz = this.timezone;
    const cap = cfg.limitPerDay ?? this.cap;
    const usedToday = this.history.appliedToday(tz);
    const remainingToday = Math.max(0, cap - usedToday);
    if (remainingToday === 0) {
      this.log(chalk.red(`Daily cap already reached (${usedToday}/${cap}).`));
      return 0;
    }

    const budget = cfg.debugTest > 0 ? Math.min(cfg.debugTest, remainingToday) : remainingToday;
    let submitted = 0;

    try {
      const browser = await launchBrowser({ headful: false });
      const page = await preparePage(browser);
      await page.goto("https://id.jobstreet.com/", { waitUntil: "domcontentloaded" });
      if (!(await isLoggedIn(page))) {
        this.log(chalk.red("Not logged in. Run `jobstreet login` first."));
        return 0;
      }
      this.log(chalk.green("Session OK."));

      const plan = this.resolveSearchPlan();
      const searchKeywords = plan.keywords;
      const searchLocation = plan.location;
      if (searchKeywords.length === 0) {
        this.log(chalk.yellow("No search keywords resolved — nothing to do."));
        return 0;
      }

      for (const keyword of searchKeywords) {
        if (submitted >= budget) break;
        this.log(chalk.bold(`\nSearching: "${keyword}" in "${searchLocation}"`));
        const links: JobLink[] = await collectJobs(page, keyword, { ...cfg, location: searchLocation }, this.log);
        const fresh = links.filter((l) => !this.history.has(l.url));
        this.log(`Collected ${links.length}, fresh ${fresh.length}`);

        for (const link of fresh) {
          if (submitted >= budget) break;
          const outcome = await applyToJob(page, link, cfg, dryRun || cfg.dryRun, this.log, this.cvRules, this.cvSkills);
          const label = chalk.dim(link.url);
          if (outcome.status === "SUBMITTED" || outcome.status === "DRY_RUN") {
            this.history.add({
              jobId: link.url,
              url: link.url,
              title: outcome.title ?? link.title,
              company: outcome.company ?? link.company,
              appliedAt: new Date().toISOString(),
              status: outcome.status === "DRY_RUN" ? "DRY_RUN" : "SUBMITTED",
              platform: "jobstreet",
              location: searchLocation,
              // Only a real submission consumes the daily budget; dry runs are probes.
              counted: outcome.status === "SUBMITTED",
            });
            submitted++;
            const icon = outcome.status === "DRY_RUN" ? chalk.yellow("DRY") : chalk.green("OK");
            this.log(`${icon} ${outcome.title} @ ${outcome.company}${outcome.reason ? ` (${outcome.reason})` : ""} ${label}`);
          } else if (outcome.status === "SKIPPED") {
            this.log(chalk.cyan(`SKIP [${outcome.reason}] ${outcome.title} @ ${outcome.company}`));
          } else {
            this.log(chalk.red(`FAIL [${outcome.reason}] ${outcome.title} ${label}`));
          }
          await sleep(jitter(cfg.minDelaySeconds, cfg.maxDelaySeconds));
        }
      }
    } finally {
      await closeBrowser();
    }

    // Consume the derivation: bump the run counter so `refreshKeywordsEvery`
    // can decide whether the next run re-derives or reuses the cache.
    const cache = this.readKeywordCache();
    if (cache) this.writeKeywordCache(cache.keywords, cache.location, cache.runs + 1);

    return submitted;
  }

  /** Pull the applied-jobs page and sync statuses into history. Never throws. */
  async syncStatus(): Promise<number> {
    let browser;
    try {
      browser = await launchBrowser({ headful: false });
      const page = await preparePage(browser);
      await page.goto("https://id.jobstreet.com/", { waitUntil: "networkidle2", timeout: 60_000 });
      if (!(await isLoggedIn(page))) {
        this.log(chalk.yellow("Not logged in — skipping sync. Run `jobstreet login` first."));
        return 0;
      }
      const jobs = await readAppliedJobs(page, 3);
      let updated = 0;
      let addedNew = 0;
      for (const j of jobs) {
        if (this.history.updateStatus(j.url, j.status || "APPLIED")) updated++;
        else if (!this.history.has(j.url)) {
          this.history.add({
            jobId: j.url,
            url: j.url,
            title: j.title,
            company: j.company,
            appliedAt: new Date().toISOString(),
            status: j.status || "APPLIED",
            platform: "jobstreet",
            // Mirrored from the board — this app never submitted it, so it must
            // not consume the shared daily budget.
            counted: false,
          });
          addedNew++;
        }
      }
      this.log(chalk.green(`Synced ${jobs.length} applied jobs (${updated} updated, ${addedNew} new).`));
      return jobs.length;
    } catch (e) {
      this.log(chalk.yellow(`Sync skipped: ${(e as Error).message}`));
      return 0;
    } finally {
      await closeBrowser().catch(() => undefined);
    }
  }

  /** Print a small status table from local history. */
  statusTable(): void {
    const tz = this.timezone;
    const rows = this.history.all();
    const today = this.history.appliedToday(tz);
    console.log(chalk.bold(`Jobstreet — today: ${today}/${this.cap} (${tz})`));
    const recent = rows.slice(0, 15);
    for (const r of recent) {
      const when = r.appliedAt.slice(0, 16).replace("T", " ");
      const st =
        r.status === "SUBMITTED" ? chalk.green(r.status)
        : r.status === "DRY_RUN" ? chalk.yellow(r.status)
        : chalk.cyan(r.status ?? "—");
      console.log(`  ${when}  ${st.padEnd(10)} ${r.title.slice(0, 50)} @ ${r.company.slice(0, 30)}`);
    }
    console.log(chalk.dim(`Total in history: ${rows.length}`));
  }
}
