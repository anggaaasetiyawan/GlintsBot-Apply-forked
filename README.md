# GlintsAuto

**🌐 Baca dalam Bahasa Indonesia → [README.id.md](README.id.md)**

Auto-apply bot for **two boards**: Glints and Jobstreet. TypeScript, terminal UI,
cron + 24/7 modes. One `config.json`, one CLI.

> Educational. Use on your own account. Don't be a dick.

## Two platforms, two transports

|               | Glints                                                   | Jobstreet                                                                          |
| ------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Transport     | **Pure HTTP** — the same mobile API the Android app uses | **Puppeteer** — real browser, persistent profile                                   |
| Auth          | `GLINTS_USERNAME` / `GLINTS_PASSWORD` in `.env`          | One-time headful `jobstreet login`; session in `.glints/jobstreet-profile`         |
| Apply flow    | One-tap apply + intro chat message                       | Wizard: `/apply` → `/apply/role-requirements` → `/apply/profile` → `/apply/review` |
| Questionnaire | `answers` bank, keyed by Glints question name            | **Derived from your CV** (`answers` + `answers.skills`)                            |
| History       | `.glints/history.json`                                   | `.glints/jobstreet-history.json`                                                   |
| Daily cap     | `limits.maxAppliesPerDay`                                | same number, own counter                                                           |

## What it does

**Glints**

- Pulls jobs from the For-You feed (and "recently added" / nearby as fallbacks).
- Filters by keywords, job type, work arrangement, min experience, fraud flag.
- One-tap-applies with answers from a config bank.
- After each apply, opens the chat channel and sends the saved intro message —
  same flow as the app.
- Live terminal dashboard while it runs.
- **24/7 auto mode**: derives keywords from your profile, loops forever,
  sleeps until next midnight when daily cap hits, exponential backoff on errors.
- Cron mode if you'd rather schedule it.
- Daily and per-run caps. Random delay between applies.
- Local history so it doesn't apply to the same job twice — including
  server-side 409 dedupe (handles "you already applied" without burning retries).
- **Customizable keyword detection** — works for IT _and_ non-IT roles.
  Auto-detect keywords from profile, or define your own industry tokens.

No browser automation for Glints — no Selenium, just HTTP.

**Jobstreet**

- Derives search keywords from your applied-job history and
  `filters.includeKeywords`, then searches each keyword in your location.
- Skips "Daftar / Apply on company website" ads — only on-site campaigns are applied to.
- Walks the whole apply wizard and answers `/apply/role-requirements` **from your CV**:
  expected salary, years of experience (per-skill questions included), education,
  right-to-work, relocation, notice period, industry, and required skill lists.
- **Overrides Jobstreet's stale pre-fills** when the CV has a better answer — it loves
  to pre-fill `Rp 4.5 Jt` and `1 year`. Overrides are logged with the old value.
- `--dry-run` reaches the final submit step and stops. Recorded as `DRY_RUN` and
  never counts against the daily cap.
- `jobstreet status` syncs from `my-activity/applied-jobs`.

## Quick Start (Non-IT Users)

New here? Follow these steps:

1. **Install Node.js** — download from [nodejs.org](https://nodejs.org/) (LTS version). Just click Next → Next → Finish.
2. **Open Terminal/Command Prompt** — press `Win + R`, type `cmd`, press Enter.
3. **Clone this repo** — `git clone https://github.com/anggaaasetiyawan/GlintsBot-Apply-forked.git`
4. **Enter the folder** — `cd GlintsBot-Apply-forked`
5. **Install dependencies** — `npm install`
6. **Setup environment** — copy `.env.example` to `.env`, fill in your Glints email and password.
7. **Setup config** — copy `config.example.json` to `config.json`, adjust your job preferences.
8. **Test Glints login** — `npx tsx src/cli.ts me`
9. **Dry run Glints** — `npx tsx src/cli.ts apply --dry-run`
10. **Log in to Jobstreet once** — `npx tsx src/cli.ts jobstreet login` (a browser
    window opens — sign in by hand with email/password and any captcha/2FA)
11. **Dry run Jobstreet** — `npx tsx src/cli.ts jobstreet apply --dry-run`
12. **Go live** — `npx tsx src/cli.ts apply` and/or `npx tsx src/cli.ts jobstreet apply`

## Setup

```bash
# Node 18.17+
npm install

cp .env.example .env
# fill GLINTS_USERNAME and GLINTS_PASSWORD

cp config.example.json config.json
# tweak filters / answers / auto loop / cron / jobstreet

# Jobstreet: sign in once, by hand, in the browser window that opens.
# The session lands in .glints/jobstreet-profile and is reused from then on.
npx tsx src/cli.ts jobstreet login
```

## Run

**Glints**

```bash
npx tsx src/cli.ts me               # check login
npx tsx src/cli.ts feed             # peek at the feed
npx tsx src/cli.ts keywords         # preview auto-derived keywords
npx tsx src/cli.ts apply --dry-run  # rehearse, no real apply
npx tsx src/cli.ts apply            # one run, with TUI
npx tsx src/cli.ts auto             # never stop — 24/7 mode
npx tsx src/cli.ts cron             # cron-scheduled runs
```

**Jobstreet**

```bash
npx tsx src/cli.ts jobstreet login            # headful once, session in .glints/jobstreet-profile
npx tsx src/cli.ts jobstreet apply            # really apply
npx tsx src/cli.ts jobstreet apply --dry-run  # reach the submit step, never click it
npx tsx src/cli.ts jobstreet status           # status table + sync from my-activity
```

For long-running on a server:

```bash
# nohup
nohup npx tsx src/cli.ts auto --no-tui > .glints/auto.log 2>&1 &

# or PM2 (auto-restart on crash, survives reboots)
pm2 start --name glints-auto -- npx tsx src/cli.ts auto --no-tui
pm2 save && pm2 startup
```

The bundled `ecosystem.config.cjs` runs Glints only (`auto --no-tui`). Jobstreet is
not wired into `auto`/`cron` — schedule `jobstreet apply` yourself if you want it
automated, and remember the profile lock allows only one process at a time.

## Commands

```
me                      show Glints profile
feed [-p N -s SIZE]     list For-You feed
keywords                preview auto-derived keywords
apply [--dry-run]       one run, with TUI
apply --no-tui          one run, plain stdout
dashboard               alias for apply
auto [--dry-run]        24/7 loop — auto keywords, auto cooldowns, auto resume
cron [--once]           cron-scheduled scheduler
history [-n N]          recent applies + today's cap
reset-day               clear today's local history (resets daily cap)
config                  print resolved config

jobstreet login         open a headful browser and sign in once
jobstreet apply         walk the wizard and submit applications
jobstreet apply --dry-run   same, but stop at the submit button
jobstreet status        status table + sync from my-activity/applied-jobs
```

`jobstreet <action>` takes exactly one of `login | apply | status`. `--dry-run`
reaches the submit step without clicking. `--config <path>` on the root command
points at a different config file.

## Config

`config.json`. The interesting bits:

```jsonc
{
  "filters": {
    "includeKeywords": ["developer", "engineer"],
    "excludeKeywords": ["sales", "marketing", "intern"],
    "jobTypes": ["FULL_TIME", "CONTRACT"],
    "minYearsOfExperienceMax": 5,
  },
  "limits": {
    "maxAppliesPerRun": 20,
    "maxAppliesPerDay": 50,
    "minDelaySeconds": 4,
    "maxDelaySeconds": 12,
  },
  "answers": {
    "years_of_relevant_experience_v2": "More than 5 years",
    "skill_set_tools": "Expert",
    "skill_set_foreign_language_v2": ["Bahasa Indonesia", "English"],
    "expected_salary_idr": 7000000,
    // Your CV's technology vocabulary. Jobstreet's required multi-select
    // questions ("which back-end frameworks can you use?") tick ONLY these
    // names. Populate it from your own CV — nothing is inferred.
    "skills": ["PHP", "Laravel", "JavaScript", "TypeScript", "Node.js"],
  },
  "intro": { "enabled": true },
  "cron": { "schedule": "0 */2 * * *", "timezone": "Asia/Jakarta" },
  "auto": {
    "cooldownMinutes": 30,
    "idleMinutes": 20,
    "refreshKeywordsEvery": 5,
    "autoKeywords": true,
    "maxConsecutiveErrors": 5,
  },
  "keywordOptions": {
    "mode": "tech",
    "customTokens": [],
    "extraRoleNouns": [],
  },
  "jobstreet": {
    "searchKeywords": ["frontend developer", "web developer"],
    "location": "jakarta",
    "limitPerDay": 50,
    "concurrency": 2,
    "maxPages": 3,
    "maxJobsPerKeyword": 40,
    "dryRun": false,
    "debugTest": 0,
    "minDelaySeconds": 3,
    "maxDelaySeconds": 6,
    "autoKeywords": true,
    "refreshKeywordsEvery": 0,
    "maxAutoKeywords": 12,
  },
}
```

### Daily cap

`limits.maxAppliesPerDay` is the **one number** both platforms obey. `config.ts`
copies it into `jobstreet.limitPerDay` unless you set that field explicitly — so
50 means 50 for Glints and 50 for Jobstreet, each counted separately. If you'd
rather split one budget across both boards, set `jobstreet.limitPerDay` lower.

Rows mirrored in from Jobstreet's applied-jobs page are stored with
`counted: false` — they appear in `history`/`jobstreet status` but **never**
consume the cap.

If a job asks a question not in `answers` and it's required, the bot logs
`missing-answers:<name>` and skips. Add it to the bank and rerun.

When `auto.autoKeywords` is true, the loop overrides `filters.includeKeywords`
with terms derived from your work experience titles, skill tags, and job-role
preferences. Run `npx tsx src/cli.ts keywords` to preview the list before turning auto on.

## Keyword Modes (`keywordOptions`)

The bot can auto-detect keywords from your profile. You control what it keeps:

| Mode       | What it does                                         | Best for                                                             |
| ---------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| `"tech"`   | Only IT-related tokens (developer, react, php, aws…) | Programmers, engineers, designers                                    |
| `"all"`    | Keep ALL meaningful words from your profile          | **Non-IT roles** — accounting, nursing, teaching, admin, sales, etc. |
| `"custom"` | Only tokens you define + role nouns                  | Full control over your industry                                      |

### Examples

**Non-IT (accountant, admin, general):**

```json
"keywordOptions": { "mode": "all" }
```

**Healthcare / Nursing:**

```json
"keywordOptions": {
  "mode": "custom",
  "customTokens": ["nursing", "patient", "clinical", "hospital", "healthcare", "medical"],
  "extraRoleNouns": ["nurse", "caregiver", "midwife", "pharmacist"]
}
```

**Finance / Accounting:**

```json
"keywordOptions": {
  "mode": "custom",
  "customTokens": ["accounting", "audit", "tax", "payroll", "banking", "finance"],
  "extraRoleNouns": ["accountant", "auditor", "bookkeeper"]
}
```

**IT + custom extras:**

```json
"keywordOptions": {
  "mode": "tech",
  "customTokens": ["healthcare", "nursing"],
  "extraRoleNouns": ["nurse"]
}
```

The same `keywordOptions` feed Jobstreet's auto-keyword derivation.

## 24/7 mode behavior

Applies to **Glints** (`auto` / `cron`). Jobstreet runs on demand.

| Outcome of a run                     | What happens next                                                       |
| ------------------------------------ | ----------------------------------------------------------------------- |
| Daily cap hit                        | Sleeps until next local midnight (`cron.timezone`), resumes             |
| Per-run cap hit                      | Sleeps `auto.cooldownMinutes` (default 30)                              |
| Feed exhausted / nothing matched     | Sleeps `auto.idleMinutes` (default 20)                                  |
| Normal progress                      | 2-minute breath, then next run                                          |
| Run threw an error                   | Backoff 2 → 4 → 8 → 16 → 32 → 60 min, bail after `maxConsecutiveErrors` |
| Server returns 409 "already applied" | Recorded as already-applied so it's never retried                       |

## Jobstreet in detail

### Login and session

`jobstreet login` opens a **headful** Chromium at Jobstreet's SEEK OAuth page and
waits up to 10 minutes for you to sign in by hand (password, captcha, 2FA — whatever
it asks). The session is written to `.glints/jobstreet-profile` and reused by every
later run. You do this **once**; after that it's headless.

`.glints/` and `session.json` are gitignored. The profile directory holds a live
authenticated session — treat it like a password.

If a run dies mid-flight it leaves the profile locked and the next run fails with
`The browser is already running for …`. Clear it with:

```bash
pkill -f "jobstreet-profile"
```

### Jobstreet config reference

| Field                                 | Default                                  | Meaning                                                                              |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `searchKeywords`                      | `["frontend developer","web developer"]` | One search pass per keyword. Ignored when `autoKeywords` is on.                      |
| `location`                            | `"jakarta"`                              | Slug or display name — `jakarta`, `bontang`, `remote`.                               |
| `limitPerDay`                         | _(shared)_                               | Optional override. Omit and `limits.maxAppliesPerDay` applies.                       |
| `concurrency`                         | `2`                                      | Parallel job-detail tabs. 2 is safe, 3+ risks captcha.                               |
| `maxPages`                            | `3`                                      | Listing pages per keyword.                                                           |
| `maxJobsPerKeyword`                   | `40`                                     | Job links collected per keyword.                                                     |
| `dryRun`                              | `false`                                  | Same as passing `--dry-run`.                                                         |
| `debugTest`                           | `0`                                      | If > 0, stop after N applications — a smoke test.                                    |
| `minDelaySeconds` / `maxDelaySeconds` | `3` / `6`                                | Delay band between applications.                                                     |
| `autoKeywords`                        | `true`                                   | Derive keywords from applied history + `filters.includeKeywords`.                    |
| `refreshKeywordsEvery`                | `0`                                      | Re-derive every N runs. `0` = every run. Cache: `.glints/jobstreet-keywords.json`.   |
| `maxAutoKeywords`                     | `12`                                     | Hard cap on derived keywords.                                                        |
| `locationOverride`                    | —                                        | Explicit location, wins over derivation. `JOBSTREET_LOCATION` env var does the same. |

Location precedence: `locationOverride` / `JOBSTREET_LOCATION` → derived from applied
history → configured `location` → `answers.domicile` → `"jakarta"`.

### How the questionnaire gets answered

`/apply/role-requirements` asks whatever that employer configured, in Indonesian or
English, and Jobstreet pre-fills it from your profile — often **wrongly** (salary
`Rp 4.5 Jt`, experience `1 year`). The bot builds an answer rule set from
`config.json → answers` and overrides the pre-fill whenever the CV has an answer.
Every override is logged so you can watch it happen:

```
A: Berapa gaji bulanan yang kamu inginkan? → Rp 7 Jt (was Rp 4.5 Jt)
A: Berapa tahun pengalaman kerjamu sebagai programmer? → Lebih dari 5 tahun (was 1 tahun)
A: Kualifikasi mana yang kamu miliki? → Sarjana (S1) (was Diploma 4)
```

What the CV drives:

- **Expected salary** — rendered the way Jobstreet renders it (`Rp 7 Jt`, `Rp 7 juta`, …),
  from `expected_salary_idr` / `expected_salary_v2`.
- **Years of experience** — including per-skill variants ("How many years' experience
  do you have using Golang?"), from `years_of_relevant_experience_v2`.
- **Education** — matches `Bachelor's Degree (S1)` and `Sarjana (S1)` alike.
- **Right to work** — `…paling mendeskripsikan hakmu bekerja di Indonesia?`.
- **Relocation / notice period / availability / work arrangement / domicile**.
- **Industry** — derived from `answers.skills` when the CV looks like IT.
- **Required multi-select skill lists** — ticks only names present in `answers.skills`.
  When the CV lists none of the offered options, it answers honestly
  (`Tidak satupun` / `None of the above`) instead of bluffing.

Nothing outside `answers` and `answers.skills` is ever invented. Keep both current —
that's the entire brain of the Jobstreet module.

### Safety

- `--dry-run` (or `jobstreet.dryRun: true`) walks to the submit button and stops.
  Recorded in history as `DRY_RUN`, which **doesn't** consume the daily cap.
- `debugTest: 0` means no early stop. Combined with a live profile, a plain
  `jobstreet apply` submits **real** applications. Dry-run first.
- Per-job log lines: `OK` submitted, `DRY` dry-run, `SKIP [reason]`, `FAIL [reason]`.

Common outcomes:

| Reason             | Meaning                                                                       |
| ------------------ | ----------------------------------------------------------------------------- |
| `ALREADY_APPLIED`  | Already in history, or the board says so.                                     |
| `EXTERNAL_APPLY`   | "Daftar / Apply on company website" — not an on-site campaign. Never clicked. |
| `NO_APPLY_BUTTON`  | No apply affordance on the detail page.                                       |
| `AUTH_REQUIRED`    | Session expired — run `jobstreet login` again.                                |
| `FLOW_STUCK`       | The wizard would not advance.                                                 |
| `SUBMIT_NOT_FOUND` | Reached review but no submit control was rendered.                            |
| `UNCONFIRMED_TEXT` | Submitted, but no success banner matched. Verify with `jobstreet status`.     |

### Troubleshooting

- **`Not logged in. Run 'jobstreet login' first.`** — session expired or the profile
  directory was deleted. Re-run `jobstreet login`.
- **`The browser is already running for …`** — an orphaned run holds the profile lock.
  `pkill -f "jobstreet-profile"`.
- **`Navigation timeout of 60000 ms exceeded`** — Jobstreet was slow or bounced through
  an OAuth re-auth interstitial. Re-run; if it repeats for one job, that ad is broken.
- **Cap looks wrong** — `npx tsx src/cli.ts jobstreet status` prints today's real count.
  Mirrored rows from `my-activity` are `counted: false` and shouldn't move it.

## How it works

```
src/
├── client.ts            Glints HTTP client — REST + 2 GraphQL endpoints
├── queries.ts           captured GraphQL ops
├── types.ts             response types
├── config.ts            config + .env
├── storage.ts           history + session JSON (timezone-aware day boundaries)
├── filters.ts           job filter rules
├── answer-bank.ts       Glints question → answer mapping
├── auto-keywords.ts     derive includeKeywords from profile + experiences
├── engine.ts            the Glints auto-apply loop
├── auto.ts              24/7 loop wrapper
├── tui.ts               terminal UI (alt-screen, diff render)
├── scheduler.ts         node-cron wrapper
├── cli.ts               commander entry
└── jobstreet/
    ├── browser.ts       puppeteer launch / page prep / jitter / sleep
    ├── types.ts         URLs, config type, login detection, navigation helpers
    ├── auto-keywords.ts derive Jobstreet keywords + location from history
    ├── bot.ts           listing collection, wizard walk, the answer engine
    └── index.ts         JobstreetBot — login / runApply / statusTable / syncStatus
```

**Glints.** The engine round-robins across feed sources, dedupes against local
history, filters, fetches per-job questions, builds answers, submits, then opens the
chat channel and sends the intro. Events flow through an EventEmitter — the
TUI and cron logger both subscribe.

`auto.ts` wraps the engine in a never-ending loop with smart waits, derives
keywords from your profile periodically, and handles cap/error states so the
process keeps grinding without intervention.

**Jobstreet.** `JobstreetBot` derives a search plan (keywords + location), collects
job links, drops anything already in `.glints/jobstreet-history.json`, then per job:
opens the detail page, skips external-apply ads, clicks through
`/apply` → `/apply/role-requirements` → `/apply/profile` → `/apply/review`, answers
every group it can (selects, checkbox groups, radio groups, free text), and submits
unless dry-running. Each answer is logged; the cap is checked before every single
application, not just at the start.

### State files

| Path                              | What it is                                               |
| --------------------------------- | -------------------------------------------------------- |
| `.glints/history.json`            | Glints apply ledger                                      |
| `.glints/jobstreet-history.json`  | Jobstreet apply ledger (`counted: false` = mirrored row) |
| `.glints/jobstreet-keywords.json` | Derived keyword/location cache + run counter             |
| `.glints/jobstreet-profile/`      | Live authenticated browser profile — treat as a secret   |
| `.glints/session.json`            | Glints session                                           |

## License

Private.
