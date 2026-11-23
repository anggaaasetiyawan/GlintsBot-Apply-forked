import { buildAnswerRules, buildSkillList } from "./src/jobstreet/bot.js";
import fs from "node:fs";

const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));
const bank = cfg.answers;
const rules = buildAnswerRules(bank);
const skills = buildSkillList(bank, cfg.jobstreet?.searchKeywords ?? []);

const norm = (s: string) =>
  (s ?? "").replace(/[\u2060\u200b\ufeff\u00a0]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

const isCatchAll = (l: string) => /^(other|others|not listed|lainnya|lain-lain)/i.test(l.trim());
const isNoneOption = (l: string) =>
  /^(none of the above|none|no experience|not applicable|n\/a|tidak satupun|tidak ada satu ?pun|tidak ada yang|tidak ada)/i.test(
    l.trim()
  );
const isRealOption = (l: string) => norm(l) !== "" && !isCatchAll(l) && !isNoneOption(l);

const matching = (q: string) =>
  rules.filter((r) => {
    try {
      return new RegExp(r.match, "i").test(q);
    } catch {
      return false;
    }
  });

const choose = (labels: string[], question: string): number => {
  const hits = matching(question);
  for (const r of hits) {
    for (const w of r.picks) {
      const nw = norm(w);
      const i = labels.findIndex((l) => norm(l) === nw);
      if (i >= 0) return i;
    }
  }
  for (const r of hits) {
    for (const w of r.picks) {
      const nw = norm(w);
      if (nw.length < 4) continue;
      const i = labels.findIndex((l) => norm(l).includes(nw));
      if (i >= 0) return i;
    }
  }
  const firstReal = labels.findIndex(isRealOption);
  return firstReal >= 0 ? firstReal : 0;
};

const rulePicks = (question: string, labels: string[]): number[] => {
  const hits = matching(question);
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

const wordHit = (needle: string, hay: string): boolean => {
  if (needle.length < 2 || hay.length < 2) return false;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^| )${esc(needle)}( |$)`).test(hay) || new RegExp(`(^| )${esc(hay)}( |$)`).test(needle);
};

const wantedSkills = (q: string, labels: string[]): number[] => {
  const qn = norm(q);
  const isSkillQuestion =
    /skills?|library|framework|tools?|technology|technologies|stack|bahasa|language|technical/i.test(q) ||
    skills.some((s) => qn.includes(norm(s)));
  if (!isSkillQuestion) return [];
  const out: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    const ln = norm(labels[i] ?? "");
    if (!ln || isCatchAll(labels[i] ?? "")) continue;
    if (skills.some((s) => wordHit(norm(s), ln))) out.push(i);
  }
  return out;
};

const wantedBoxes = (q: string, labels: string[]): { tier: string; picks: string[] } => {
  const s = wantedSkills(q, labels);
  if (s.length) return { tier: "cv-skills", picks: s.map((i) => labels[i]) };
  const n = rulePicks(q, labels);
  if (n.length) return { tier: "rule-picks", picks: n.map((i) => labels[i]) };
  const none = labels.findIndex((l) => isNoneOption(l));
  if (none >= 0) return { tier: "none-option", picks: [labels[none]] };
  if (labels.length > 0 && labels.length <= 12) {
    const fr = labels.findIndex(isRealOption);
    if (fr >= 0) return { tier: "short-list-first", picks: [labels[fr]] };
  }
  return { tier: "UNANSWERED", picks: [] };
};

const SEL_YEARS_EN = ["", "No experience", "Less than 1 year", "1 year", "2 years", "3 years", "4 years", "5 years", "More than 5 years"];
const SEL_YEARS_ID = ["Tidak ada pengalaman", "Kurang dari 1 tahun (kurang dari 2.080 jam)", "1 tahun (2.080 jam)", "2 tahun (4.160 jam)", "3 tahun (6.240 jam)", "4 tahun (8.320 jam)", "5 tahun (10.400 jam)", "Lebih dari 5 tahun (lebih dari 10.400 jam)"];
const SEL_SALARY = ["Rp 1 Jt", "Rp 1,5 Jt", "Rp 2 Jt", "Rp 2,5 Jt", "Rp 3 Jt", "Rp 3,5 Jt", "Rp 4 Jt", "Rp 4,5 Jt", "Rp 5 Jt", "Rp 5,5 Jt", "Rp 6 Jt", "Rp 6,5 Jt", "Rp 7 Jt", "Rp 7,5 Jt", "Rp 8 Jt", "Rp 8,5 Jt", "Rp 9 Jt", "Rp 9,5 Jt", "Rp 10 Jt"];
const SEL_RTW = ["", "Saya adalah warga negara Indonesia", "Saya memiliki izin Ketenagakerjaan/Kerja", "Saya memiliki izin tinggal Indonesia (KITAS/KITAP)", "Saya memiliki Visa Bisnis", "Saya memiliki ABTC (APEC Business Travel Card)", "Saya membutuhkan sponsor untuk bekerja pada perusahaan baru di Indonesia"];
const SEL_EDU = ["", "Diploma 3", "Sarjana (S1)", "Magister (S2)", "Doktor (S3)"];
const SEL_RELOCATE = ["", "Yes", "No"];

const cases: Array<[string, string[]]> = [
  ["How many years' experience do you have as a Product Engineer?", SEL_YEARS_EN],
  ["How many years' experience do you have as a systems engineer?", SEL_YEARS_EN],
  ["Berapa tahun pengalaman kerjamu di bidang Pengembangan Basis Data?", SEL_YEARS_ID],
  ["Berapa gaji bulanan yang kamu inginkan?", SEL_SALARY],
  ["Pernyataan mana di bawah ini yang paling mendeskripsikan hakmu bekerja di Indonesia?", SEL_RTW],
  ["Kualifikasi mana yang kamu miliki?", SEL_EDU],
  ["Are you willing to relocate?", SEL_RELOCATE],
];

console.log(`rules=${rules.length}  skills=${skills.length}\n`);
for (const [q, labels] of cases) {
  const idx = choose(labels, q);
  const flag = /no experience|tidak ada pengalaman/i.test(labels[idx] ?? "") ? "  <-- UNDER-CLAIM" : "";
  console.log(`Q: ${q.slice(0, 78)}`);
  console.log(`   rules-hit=${matching(q).length}  →  "${labels[idx]}"${flag}`);
}

console.log("\n--- checkbox groups (real option lists) ---");
const cbCases: Array<[string, string[]]> = [
  ["Library/framework back end apa saja di bawah ini yang bisa kamu gunakan?", ["CodeIgniter", "Yii", "Joomla", "CakePHP", "Zend", "Django", "Ruby on Rails", "Struts 2", "Symfony", "Apache", "SciPy", "Play", "NumPy", "Grails", "Tidak satupun"]],
  ["Which of these industries have you worked in?", ["Accounting", "Banking and Financial Services", "Construction", "Education and Training", "Healthcare and Medical", "Hospitality and Tourism", "Information Technology", "Manufacturing, Transport and Logistics", "Marketing and Communications", "Retail and Consumer Products", "None of the above"]],
  ["Which of these industries have you worked in?", ["Accounting", "Banking and Financial Services", "Construction", "Education and Training", "Healthcare and Medical", "Hospitality and Tourism", "Manufacturing, Transport and Logistics", "Marketing and Communications", "Retail and Consumer Products"]],
];
for (const [q, labels] of cbCases) {
  const r = wantedBoxes(q, labels);
  console.log(`${q.slice(0, 60)}\n   tier=${r.tier}  picks=${JSON.stringify(r.picks)}`);
}
