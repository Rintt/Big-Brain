import { listSkills, type Skill } from "./registry.js";

export type SearchSkillsOptions = {
  cwd: string;
  query: string;
};

export type SkillSearchResult = {
  skill: Skill;
  score: number;
  matches: string[];
};

export async function searchSkills(options: SearchSkillsOptions): Promise<SkillSearchResult[]> {
  const terms = options.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return [];
  }

  const skills = await listSkills({ cwd: options.cwd });
  const results: SkillSearchResult[] = [];

  for (const skill of skills) {
    const haystacks = [
      { field: "name", value: skill.name },
      { field: "description", value: skill.description ?? "" },
      { field: "body", value: skill.body }
    ];
    let score = 0;
    const matches: string[] = [];

    for (const term of terms) {
      for (const haystack of haystacks) {
        if (haystack.value.toLowerCase().includes(term)) {
          score += haystack.field === "name" ? 5 : haystack.field === "description" ? 3 : 1;
          matches.push(`${haystack.field}:${term}`);
          break;
        }
      }
    }

    if (score > 0) {
      results.push({ skill, score, matches });
    }
  }

  return results.sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name));
}
