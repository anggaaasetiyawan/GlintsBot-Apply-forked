import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** "YYYY-MM-DD" in the requested IANA timezone (or the host local zone). */
export function localDayKey(d: Date, timezone?: string): string {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(d); // en-CA already gives YYYY-MM-DD
  } catch {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
}

export interface AppliedRecord {
  jobId: string;
  title: string;
  company: string;
  appliedAt: string; // ISO
  status?: string;
  applicationId?: string;
  source?: string;
  traceInfo?: string;
  /** Which board this record belongs to. Undefined = "glints" (legacy data). */
  platform?: "glints" | "jobstreet";
  /** Jobstreet: absolute URL of the posting. */
  url?: string;
  /** Jobstreet: search location slug the posting was found under (e.g. "jakarta", "jakarta-selatan"). */
  location?: string;
  /** Records that only mirror the board (never reached submit) must not eat the daily cap. */
  counted?: boolean;
}

export interface SessionRecord {
  accessToken?: string | null;
  refreshToken?: string | null;
  deviceId?: string;
  savedAt: string;
}

export class JsonStore<T> {
  private path: string;
  private cache: T;

  constructor(path: string, defaultValue: T) {
    this.path = resolve(process.cwd(), path);
    if (existsSync(this.path)) {
      try {
        this.cache = JSON.parse(readFileSync(this.path, "utf8")) as T;
      } catch {
        this.cache = defaultValue;
      }
    } else {
      this.cache = defaultValue;
    }
  }

  get(): T { return this.cache; }

  set(value: T): void {
    this.cache = value;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(value, null, 2), "utf8");
  }

  update(fn: (prev: T) => T): T {
    const next = fn(this.cache);
    this.set(next);
    return next;
  }
}

export class History {
  private store: JsonStore<{ applied: AppliedRecord[] }>;

  constructor(path = ".glints/history.json") {
    this.store = new JsonStore(path, { applied: [] });
  }

  all(): AppliedRecord[] {
    return this.store.get().applied;
  }

  has(jobId: string): boolean {
    return this.store.get().applied.some((r) => r.jobId === jobId);
  }

  /** Add a record (dedup by jobId). */
  add(rec: AppliedRecord): void {
    this.store.update((s) => ({ applied: [rec, ...s.applied.filter((r) => r.jobId !== rec.jobId)].slice(0, 5000) }));
  }

  /**
   * Count of applies on the local calendar day. Pass a timezone (IANA) to use
   * that zone's midnight instead of the host's local zone. Falls back to host
   * local on bad input.
   */
  appliedToday(timezone?: string): number {
    const today = localDayKey(new Date(), timezone);
    return this.store.get().applied.filter((r) => {
      // Mirrored rows (board sync, expired re-checks) are history, not applications.
      if (r.counted === false) return false;
      try { return localDayKey(new Date(r.appliedAt), timezone) === today; }
      catch { return r.appliedAt.startsWith(today); }
    }).length;
  }

  /** Remove entries whose appliedAt falls on `today` in the given timezone. */
  clearDay(timezone?: string): number {
    const today = localDayKey(new Date(), timezone);
    let removed = 0;
    this.store.update((s) => {
      const kept = s.applied.filter((r) => {
        const same = localDayKey(new Date(r.appliedAt), timezone) === today;
        if (same) removed++;
        return !same;
      });
      return { applied: kept };
    });
    return removed;
  }

  appliedSince(sinceMs: number): AppliedRecord[] {
    const cutoff = Date.now() - sinceMs;
    return this.store.get().applied.filter((r) => Date.parse(r.appliedAt) >= cutoff);
  }
}

export class SessionStore {
  private store: JsonStore<SessionRecord>;
  constructor(path = ".glints/session.json") {
    this.store = new JsonStore(path, { savedAt: new Date(0).toISOString() });
  }
  load(): SessionRecord { return this.store.get(); }
  save(s: Omit<SessionRecord, "savedAt">): void {
    this.store.set({ ...s, savedAt: new Date().toISOString() });
  }
}

/**
 * Jobstreet history — same day-cap semantics as `History`, but a separate file
 * so the two boards never eat each other's daily quota. `jobId` holds the
 * absolute job URL (Jobstreet has no stable numeric id in the listing DOM).
 */
export class JobstreetHistory {
  private store: JsonStore<{ applied: AppliedRecord[] }>;

  constructor(path = ".glints/jobstreet-history.json") {
    this.store = new JsonStore(path, { applied: [] });
  }

  all(): AppliedRecord[] { return this.store.get().applied; }

  has(jobKey: string): boolean {
    return this.store.get().applied.some((r) => r.jobId === jobKey);
  }

  appliedToday(timezone?: string): number {
    const today = localDayKey(new Date(), timezone);
    return this.store.get().applied.filter((r) => {
      // Mirrored rows (board sync, expired re-checks) are history, not applications.
      if (r.counted === false) return false;
      try { return localDayKey(new Date(r.appliedAt), timezone) === today; }
      catch { return r.appliedAt.startsWith(today); }
    }).length;
  }

  clearDay(timezone?: string): number {
    const today = localDayKey(new Date(), timezone);
    let removed = 0;
    this.store.update((s) => {
      const kept = s.applied.filter((r) => {
        const same = localDayKey(new Date(r.appliedAt), timezone) === today;
        if (same) removed++;
        return !same;
      });
      return { applied: kept };
    });
    return removed;
  }

  add(rec: AppliedRecord): void {
    this.store.update((s) => ({ applied: [rec, ...s.applied.filter((r) => r.jobId !== rec.jobId)].slice(0, 5000) }));
  }

  /** Sync status back from the applied-jobs page. Returns number of records touched. */
  updateStatus(jobKey: string, status: string): boolean {
    let changed = false;
    this.store.update((s) => ({
      applied: s.applied.map((r) => {
        if (r.jobId === jobKey && r.status !== status) { changed = true; return { ...r, status }; }
        return r;
      }),
    }));
    return changed;
  }
}
