import { type Skill } from "./registry.js";
export type SearchSkillsOptions = {
    cwd: string;
    query: string;
};
export type SkillSearchResult = {
    skill: Skill;
    score: number;
    matches: string[];
};
export declare function searchSkills(options: SearchSkillsOptions): Promise<SkillSearchResult[]>;
