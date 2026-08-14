export type SkillSource = {
    source: string;
    sourceType: string;
    skillPath: string;
    computedHash: string;
};
export type Skill = {
    name: string;
    folderName: string;
    path: string;
    description: string | null;
    disableModelInvocation: boolean;
    body: string;
    source: SkillSource | null;
    agentConfigs: string[];
};
export type ListSkillsOptions = {
    cwd: string;
};
export declare function listSkills(options: ListSkillsOptions): Promise<Skill[]>;
export declare function getSkill(options: ListSkillsOptions & {
    name: string;
}): Promise<Skill | null>;
