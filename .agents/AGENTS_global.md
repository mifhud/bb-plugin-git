<title>Agent Guidelines — General Rules</title>

<description>

These rules are **general** and apply to all projects. Use as the primary operational standard when working with any codebase.

</description>

## 1. Reply in English or Indonesian
Responses to the user must be in English or Indonesian

<tool_priority>

## 2. Tool Priority for Codebase Exploration (Mandatory)

Always follow this priority order when exploring codebases:

| Priority       | Tool                   | When to Use                                                                                                                         |
| -------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **1 (First)**  | **Codegraph MCP**          | For **ALL initial exploration** of the codebase — architecture, data flow, call path, impact analysis, and component relationships. |
| **2 (Second)** | **Serena MCP**             | For symbolic details — file structure, method definitions, refactoring, rename, safe-delete, and quality gate.                      |
| **3 (Last)**   | **Grep / Glob / Read** | Fallback only for resource files, config, string literals, or when Codegraph &amp; Serena don't cover it.                           |

<golden_rule>

**Codegraph FIRST for initial exploration. Serena SECOND for details. Grep LAST for fallback.**

</golden_rule>

</tool_priority>

<fallack_hierarchy>

## 3. Fallback Hierarchy (Summary)

Quick reference for tool selection:

```
Initial Exploration    → Codegraph
Details / Refactoring  → Serena
Resources / Config     → Grep / Glob / Read
Complex / Parallel     → Subagent
```

</fallback_hierarchy>

<codegraph_rules>

## 4. MCP Codegraph Rules

Always call `codegraph_codegraph_explore` **as the first step** when:

- Exploring an unfamiliar codebase.
- Finding flows between components (e.g., "how does it go from Controller to DAO?").
- Performing **impact analysis** / blast radius (e.g., "if I change method X, what breaks?").
- Answering architectural questions (e.g., "who calls MailAlert?").

<how_to_use>

- Pass `projectPath` pointing to the project directory (or subdirectory that has `.codegraph/`).
- Query can be a symbol name or natural language.
- If the project doesn't have a `.codegraph/` index yet, fallback to Serena + Grep.

</how_to_use>

</codegraph_rules>

<serena_rules>

## 5. MCP Serena Rules (Aggressive Use for Details)

After Codegraph provides the big picture, use Serena for precise symbolic operations:

<file_exploration>

- `serena_get_symbols_overview` — understand class/method structure in a single file.
- `serena_find_symbol` / `serena_find_declaration` — find exact definition locations.
- `serena_find_referencing_symbols` — find all usages of a symbol.
- `serena_find_implementations` — find implementations of interface / abstract class.

</file_exploration>

<refactoring>

- `serena_rename_symbol` — rename across the codebase.
- `serena_safe_delete_symbol` — delete symbol if safe (no references).
- `serena_replace_symbol_body` — replace method/class body.
- `serena_insert_after_symbol` / `serena_insert_before_symbol` — add new method/class.

</refactoring>

<quality_gate>

- `serena_get_diagnostics_for_file` — run before completing a task. Fix all errors (severity 1) and warnings (severity 2).

</quality_gate>

<project_activation>

- Always activate the project via `serena_activate_project` before symbolic operations.

</project_activation>

</serena_rules>

<subagent_strategy>

## 6. Subagent Strategy (Mandatory)

- **Use subagents liberally** to keep the main context window clean.
- **Offload** research, exploration, and parallel analysis to subagents.
- **For complex problems, throw more compute at it via subagents**.
- **One tack per subagent for focused execution** — one focus, one goal, one code area.

<example_subagent_division>

- Subagent A: Model / DAO / database layer exploration.
- Subagent B: Message processing flow / business logic analysis.
- Subagent C: Bug investigation or test verification.

</example_subagent_division>

</subagent_strategy>

<core_principles>

## 7. Core Principles

- **Simplicity First**: Make every change as minimal as possible. Touch as little code as possible.
- **No Laziness**: Find the root cause. No quick fixes or temporary patches. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing new bugs.

</core_principles>

<additional_notes>

## 8. Additional Notes

- These rules are **global / general**. Each project may have an additional `AGENTS.md` in subdirectories for technology-specific rules (Java, Python, Node.js, etc.).
- These rules override suboptimal default behavior (e.g., the habit of using Grep before Codegraph).
- **Codegraph** and **Serena** are **MCP (Model Context Protocol)** servers — Codegraph is the MCP Codegraph server, and Serena is the Serena MCP server. They are invoked via their respective tool prefixes (`codegraph_` and `serena_`). No extra setup is required beyond having the MCP servers configured in the environment.

</additional_notes>

<commit_rules>

## 9. Commit Rules (Mandatory)

- **Required** to use the `git-commit-workflow` skill for every commit. Must check protected files based `git-commit-workflow` skill.
- Commit only on explicit user request, never automatically.
- Use **Conventional Commits** format without scope.
- Protected files must not be included in commits — skip them and warn the user.

</commit_rules>

<question_rules>

## 10. Question Rules

- **Must** use the `question` tool whenever there is an ambiguity, a decision point, or clarification needed from the user.
- Never assume user intent — ask when uncertain.

</question_rules>

<document_skills>

## 11. Document &amp; Image Processing Skills (PDF, XLSX, DOCX, PPTX, IMAGE)

When a user attaches, mentions, or requests work with document or image files (.pdf, .xlsx, .xlsm, .csv, .tsv, .docx, .doc, .pptx, .png, .jpg, .jpeg, .gif, .bmp, .webp, .tiff), you MUST:

1. **Load the appropriate skill first** using the `skill` tool before any processing:
  - PDF → `skill tool name: "pdf"`
  - Spreadsheet → `skill tool name: "xlsx"`
  - Word document → `skill tool name: "docx"`
  - PowerPoint → `skill tool name: "pptx"`
   - Image → `skill tool name: "vision"`
2. **Use the tools and workflows from the skill guide** — never read these files as raw text or use ad-hoc methods.

### Vision Agent

- **Agent**: `@vision` — dedicated vision subagent for visual analysis (description, OCR, chart reading, screenshot debugging) and Pillow-based edits (crop, resize, format conversion).
- **Delegate to @vision when**: Reading/analyzing image contents, extracting text from screenshots, interpreting charts/diagrams, performing simple image edits.
- **Don't delegate to @vision when**: The image is just a supporting reference and the orchestrator can read it directly.

### Web Debugger Agent

- **Agent**: `@web-debugger` — web debugging specialist using Chrome DevTools MCP for live browser inspection.
- **Delegate to @web-debugger when**: Debugging frontend issues, inspecting console errors, analyzing network requests, profiling performance, checking responsive layouts, or interacting with DOM elements directly in the browser.
- **Don't delegate to @web-debugger when**: The issue is purely backend/API without browser context, or static code analysis is sufficient.

</document_skills>