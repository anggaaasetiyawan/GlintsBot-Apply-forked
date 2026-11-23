import fs from "node:fs";
import { buildAnswerRules, buildSkillList } from "./src/jobstreet/bot.js";

const cfg = JSON.parse(fs.readFileSync("config.json", "utf8"));
const bank = cfg.answers ?? {};
const hints = [...(cfg.filters?.includeKeywords ?? []), ...(cfg.jobstreet?.searchKeywords ?? [])];
const skills = buildSkillList(bank, hints);
const rules = buildAnswerRules(bank);

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordHit = (needle: string, hay: string) => {
  if (needle.length < 2 || hay.length < 2) return false;
  return new RegExp(`(^| )${esc(needle)}( |$)`).test(hay) || new RegExp(`(^| )${esc(hay)}( |$)`).test(needle);
};
const tick = (labels: string[]) => labels.filter((b) => skills.some((s) => wordHit(norm(s), norm(b))));

console.log("bank.skills:", (bank.skills ?? []).length, "derived vocabulary:", skills.length, "rules:", rules.length);
console.log("empty bank:", buildSkillList({}, []).length, buildAnswerRules({}).length);
console.log("backend:", tick(["Java", "PHP", "Laravel", "Node.js", "Python", "C#", "Golang", "Ruby", "Other"]));
console.log("frontend:", tick(["React", "Vue", "Angular", "Svelte", "Next.js", "HTML/CSS", "Other"]));
console.log("database:", tick(["MySQL", "PostgreSQL", "MongoDB", "SQL Server", "Other"]));
console.log("devops:", tick(["Docker", "Kubernetes", "Jenkins", "GitLab CI", "Terraform", "Other"]));
console.log("false-positive check (marketing list):", tick(["Digital Marketing", "SEO", "Copywriting", "Sales", "Other"]));
console.log("20-option unknown matrix:", tick(Array.from({ length: 20 }, (_, i) => `Skill ${i + 1}`)).length, "(expect 0)");
