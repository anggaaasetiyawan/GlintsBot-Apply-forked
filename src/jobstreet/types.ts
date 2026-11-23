import type { Page } from "puppeteer";
import { jitter, sleep } from "./browser.js";

export const BASE = "https://id.jobstreet.com";
/** Jobstreet's real sign-in route is the SEEK OAuth app, NOT /id/login (404). */
export const LOGIN_URL = `${BASE}/id/oauth/login`;
export const APPLIED_URL = `${BASE}/id/my-activity/applied-jobs`;

export interface JobstreetConfig {
  searchKeywords: string[];
  location: string;
  /**
   * Optional override for the daily cap. Omitted = follow the shared
   * `limits.maxAppliesPerDay` from config.json, so both boards share one limit.
   */
  limitPerDay?: number;
  concurrency: number;
  maxPages: number;
  maxJobsPerKeyword: number;
  dryRun: boolean;
  debugTest: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  /** Derive keywords + location from applied history instead of the static list. */
  autoKeywords?: boolean;
  /** Re-derive every N runs (0 = every run). */
  refreshKeywordsEvery?: number;
  /** Hard cap on auto-derived keywords. */
  maxAutoKeywords?: number;
  /** Explicit location override; wins over derivation. */
  locationOverride?: string;
}

export interface JobLink {
  url: string;
  title: string;
  company: string;
}

export interface ApplyOutcome {
  status: "SUBMITTED" | "DRY_RUN" | "SKIPPED" | "FAILED";
  reason?: string;
  title?: string;
  company?: string;
}

export type LogFn = (msg: string) => void;

/** Slugify a keyword/location for Jobstreet's URL shape. */
export function slug(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/** Build a search URL. `https://id.jobstreet.com/id/{kw}-jobs/in-{loc}` */
export function searchUrl(keyword: string, location: string, page = 1): string {
  const kw = slug(keyword);
  const loc = slug(location);
  const base = loc && loc !== "all" ? `${BASE}/id/${kw}-jobs/in-${loc}` : `${BASE}/id/${kw}-jobs`;
  return page > 1 ? `${base}?page=${page}` : base;
}

/**
 * Detect whether the current page is actually logged in.
 * Auth pages (SEEK OAuth app) always mean "not logged in yet".
 * A member nav link (my-activity / profile / user menu) means logged in.
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (/oauth|\/login|signin|\/authorize/i.test(url)) return false;

    await page
      .waitForSelector(
        'a[href*="my-activity"], [data-automation="user-menu"], button[data-automation="user-avatar"], a[href*="/profile"]',
        { timeout: 8_000 }
      )
      .catch(() => undefined);

    return await page.evaluate(() => {
      const hasMemberNav = !!document.querySelector(
        'a[href*="my-activity"], [data-automation="user-menu"], button[data-automation="user-avatar"], a[href*="/profile"]'
      );
      if (hasMemberNav) return true;
      const body = (document.body?.innerText ?? "").toLowerCase();
      const hasSignIn = /\b(sign in|masuk|log in)\b/.test(body);
      const hasAccount = /\b(my activity|aktivitas saya|my profile|profil saya|saved jobs|logout|keluar)\b/.test(body);
      return hasAccount && !hasSignIn;
    });
  } catch {
    return false;
  }
}

/** Navigate to the my-activity page, tolerating SPA re-navigation. */
export async function gotoApplied(page: Page, pageNo = 1): Promise<void> {
  await page.goto(`${APPLIED_URL}?page=${pageNo}`, {
    waitUntil: "networkidle2",
    timeout: 60_000,
  }).catch(() => undefined);
  // Give the SPA time to finish client-side routing before any evaluate.
  await sleep(jitter(1.5, 2.5));
  await page
    .waitForSelector('div[data-automation^="job-item-"], [data-automation="empty-state"]', {
      timeout: 15_000,
    })
    .catch(() => undefined);
}

/** Resolve the Jobstreet URL for a puppeteer page. Utility for workers. */
export async function gotoSearch(page: Page, keyword: string, location: string, pageNo = 1): Promise<void> {
  await page.goto(searchUrl(keyword, location, pageNo), { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-automation="job-list-item-link-overlay"], a[data-automation="jobTitle"]', {
    timeout: 20_000,
  }).catch(() => undefined);
}
