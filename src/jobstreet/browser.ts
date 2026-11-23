import puppeteer, { type Browser, type Page } from "puppeteer";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

export const PROFILE_DIR = ".glints/jobstreet-profile";

export interface LaunchOpts {
  /** Headful — required for the first manual login (captcha / 2FA). */
  headful?: boolean;
}

let cachedBrowser: Browser | null = null;

/** Resolve the puppeteer-managed chrome binary (npm postinstall is often blocked). */
async function chromePath(): Promise<string | undefined> {
  try {
    const p = await puppeteer.executablePath();
    return p || undefined;
  } catch {
    return undefined;
  }
}

export async function launchBrowser(opts: LaunchOpts = {}): Promise<Browser> {
  if (cachedBrowser?.connected) return cachedBrowser;
  mkdirSync(resolve(process.cwd(), PROFILE_DIR), { recursive: true });
  const exec = await chromePath();
  cachedBrowser = await puppeteer.launch({
    headless: opts.headful ? false : true,
    executablePath: exec,
    defaultViewport: { width: 1366, height: 850 },
    userDataDir: resolve(process.cwd(), PROFILE_DIR),
    args: [
      "--no-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
    ],
  });
  cachedBrowser.once("disconnected", () => { cachedBrowser = null; });
  return cachedBrowser;
}

/** Stealth-ish baseline applied to every page. */
export async function preparePage(browser: Browser): Promise<Page> {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    // tsx/esbuild injects a __name() helper into serialized functions; the
    // browser context has no such global — shim it so page.evaluate survives.
    const g = globalThis as unknown as Record<string, unknown>;
    if (typeof g.__name !== "function") {
      g.__name = (fn: unknown) => fn;
    }
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  await page.setUserAgent(
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36"
  );
  await page.setDefaultNavigationTimeout(60_000);
  return page;
}

export async function closeBrowser(): Promise<void> {
  if (cachedBrowser) {
    try { await cachedBrowser.close(); } catch { /* already gone */ }
    cachedBrowser = null;
  }
}

/** Random pause inside [min, max] ms. */
export const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

export const jitter = (minSec: number, maxSec: number): number =>
  Math.round((minSec + Math.random() * (maxSec - minSec)) * 1000);
