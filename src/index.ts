import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"

const SKILLS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "skills")

type Frontmatter = Record<string, unknown>

/**
 * Minimal frontmatter reader for the subset the Unity skills use: `name`,
 * `description` (including folded `>-` blocks), and
 * `metadata.opencode/autoinvoke`. Unknown keys are ignored rather than
 * validated, so skills stay portable across Claude Code, Codex, and OpenCode.
 */
function parseFrontmatter(text: string): { data: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!match) return { data: {}, body: text }

  const lines = match[1].split(/\r?\n/)
  const data: Frontmatter = {}
  let cursor = 0

  while (cursor < lines.length) {
    const line = lines[cursor]
    if (!/^[A-Za-z0-9_.-]+:/.test(line)) {
      cursor++
      continue
    }

    const key = line.slice(0, line.indexOf(":")).trim()
    const rest = line.slice(line.indexOf(":") + 1).trim()

    // Folded or literal block scalar: consume the indented lines beneath it.
    if (rest === ">" || rest === ">-" || rest === "|" || rest === "|-") {
      const parts: string[] = []
      cursor++
      while (cursor < lines.length && (/^\s+\S/.test(lines[cursor]) || lines[cursor].trim() === "")) {
        parts.push(lines[cursor].trim())
        cursor++
      }
      while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop()
      data[key] = rest.startsWith(">") ? parts.join(" ") : parts.join("\n")
      continue
    }

    // Nested block (list or map). Kept as raw lines under the key.
    if (rest === "") {
      const parts: string[] = []
      cursor++
      while (cursor < lines.length && (/^\s+\S/.test(lines[cursor]) || lines[cursor].trim() === "")) {
        parts.push(lines[cursor].trim())
        cursor++
      }
      data[key] = parts
      continue
    }

    data[key] = rest.replace(/^["']|["']$/g, "")
    cursor++
  }

  const body = text.slice(match[0].length)
  const metadata = data.metadata
  if (Array.isArray(metadata)) {
    const autoinvoke = metadata.find((entry) => typeof entry === "string" && entry.startsWith("opencode/autoinvoke:"))
    if (autoinvoke) data["opencode/autoinvoke"] = autoinvoke.slice("opencode/autoinvoke:".length).trim() === "false"
  }

  return { data, body }
}

async function loadSkills() {
  const entries = await readdir(SKILLS_DIR, { withFileTypes: true })
  const skills = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(SKILLS_DIR, entry.name, "SKILL.md")

    let text: string
    try {
      text = await readFile(path, "utf8")
    } catch {
      continue
    }

    const { data, body } = parseFrontmatter(text)
    const name = typeof data.name === "string" ? data.name : entry.name
    const description = typeof data.description === "string" ? data.description : undefined

    skills.push({
      // Skill IDs come from the directory name so they stay stable even if a
      // skill's display name changes.
      id: entry.name,
      name,
      description,
      autoinvoke: data["opencode/autoinvoke"] !== false,
      path,
      content: body.trimStart(),
    })
  }

  return skills
}

export default Plugin.define({
  id: "unity",
  async setup(ctx) {
    const skills = await loadSkills()

    const skillRegistration = await ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill)
    })

    const mcpRegistration = await ctx.mcp.transform((editor) => {
      editor.set("unity", { type: "local", command: ["unity", "mcp"] })
    })

    return async () => {
      await skillRegistration.dispose()
      await mcpRegistration.dispose()
    }
  },
})