import fs from "node:fs";
import path from "node:path";

export function loadPromptTemplate(rootDir, name) {
  const fp = path.join(rootDir, "prompts", `${name}.md`);
  if (!fs.existsSync(fp)) return null;
  return fs.readFileSync(fp, "utf8");
}

export function interpolateTemplate(template, variables) {
  return template.replace(/\{\{([A-Z_][A-Z0-9_]*)\}\}/g, (match, key) => {
    return variables[key] !== undefined ? String(variables[key]) : match;
  });
}
