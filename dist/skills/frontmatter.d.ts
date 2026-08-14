export type SkillFrontmatter = {
    name?: string;
    description?: string;
    disableModelInvocation?: boolean;
};
export type ParsedSkillDocument = {
    frontmatter: SkillFrontmatter;
    body: string;
};
export declare function parseSkillDocument(content: string): ParsedSkillDocument;
