export type SkillFrontmatter = {
  name?: string;
  description?: string;
  disableModelInvocation?: boolean;
};

export type ParsedSkillDocument = {
  frontmatter: SkillFrontmatter;
  body: string;
};

export function parseSkillDocument(content: string): ParsedSkillDocument {
  if (!content.startsWith("---\n")) {
    return { frontmatter: {}, body: content };
  }

  const endIndex = content.indexOf("\n---", 4);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterText = content.slice(4, endIndex);
  const body = content.slice(endIndex + "\n---".length).replace(/^\r?\n/, "");
  const frontmatter: SkillFrontmatter = {};

  for (const line of frontmatterText.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    const value = unquote(rawValue);

    if (key === "name") {
      frontmatter.name = value;
    }
    if (key === "description") {
      frontmatter.description = value;
    }
    if (key === "disable-model-invocation") {
      frontmatter.disableModelInvocation = value === "true";
    }
  }

  return { frontmatter, body: body.trimStart() };
}

function unquote(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}
