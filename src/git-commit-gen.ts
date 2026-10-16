/**
 * AI-powered commit message generation — ported from bb-plugin-rephrase's
 * agent-thread pattern. Collects staged diffs, sends them to a configured
 * model in a hidden throwaway thread, and returns the generated message.
 */

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { runGit, gitOk } from "./shell.ts";
import type { AgentSelection, ModelChoice } from "../shared.ts";

/** Instruction sent when the setting is left empty. */
export const DEFAULT_COMMIT_INSTRUCTION = [
  "Generate a concise, conventional commit message for the staged git changes below.",
  "",
  "Rules:",
  "- Follow Conventional Commits format: <type>: <description>",
  "- Use types: feat, fix, refactor, docs, test, chore, perf, ci, build, style",
  "- Keep the description under 72 characters",
  "- Do NOT include a body or footer unless the changes clearly require it",
  "- Do NOT wrap the message in quotes, code fences, or backticks",
  "- Reply with ONLY the commit message text. No preamble, no explanation.",
].join("\n");

/** kv key holding the chosen agent for commit messages. */
const SELECTION_KEY = "commit-agent-selection";

/** kv key holding the last discovered model catalogue. */
const CATALOG_KEY = "commit-model-catalog";

/** Realtime channel telling open pickers that the catalogue moved. */
export const CATALOG_CHANNEL = "commit-catalog";

/** How long a stored catalogue is served before it is refreshed. */
const CATALOG_TTL_MS = 10 * 60_000;

type PermissionMode = "auto" | "accept-edits" | "full";

/** Least to most privileged; the first one a provider supports is used. */
const PERMISSION_MODE_PREFERENCE: readonly PermissionMode[] = [
  "auto",
  "accept-edits",
  "full",
];

/* ------------------------------------------------------------------ */
/* Staged diff collection                                              */
/* ------------------------------------------------------------------ */

/**
 * Collect `git diff --cached` output for all staged files, capped so the
 * prompt never exceeds a reasonable context window.
 */
export async function collectStagedDiff(
  targetDir: string,
): Promise<string> {
  const result = await runGit(["diff", "--cached", "--stat"], {
    cwd: targetDir,
    timeout: 10_000,
  });
  if (!gitOk(result)) return "";

  // Get full diff but cap at ~30KB to avoid blowing up the prompt
  const diffResult = await runGit(["diff", "--cached"], {
    cwd: targetDir,
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  if (!gitOk(diffResult)) return result.stdout;

  const diff = diffResult.stdout;
  const MAX_DIFF_CHARS = 30_000;
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  return diff.slice(0, MAX_DIFF_CHARS) + "\n\n... (truncated)";
}

/* ------------------------------------------------------------------ */
/* Prompt builder + output cleaner                                     */
/* ------------------------------------------------------------------ */

export function buildCommitPrompt(instruction: string, diff: string): string {
  return [
    instruction,
    "",
    "--- STAGED CHANGES ---",
    diff,
    "--- END OF CHANGES ---",
  ].join("\n");
}

/**
 * Agents like to dress an answer up. Strip the wrapping the instruction asks
 * them to leave out rather than pasting it into the commit box.
 */
export function cleanAgentOutput(output: string): string {
  let text = output.trim();

  const fence = /^```[^\n]*\n([\s\S]*?)\n?```$/;
  const fenced = fence.exec(text);
  if (fenced) text = fenced[1]!.trim();

  const quoted = /^"([\s\S]+)"$/.exec(text) ?? /^'([\s\S]+)'$/.exec(text);
  if (quoted && !quoted[1]!.includes('"')) text = quoted[1]!.trim();

  return text;
}

/* ------------------------------------------------------------------ */
/* Catalog cache                                                       */
/* ------------------------------------------------------------------ */

interface CatalogSnapshot {
  choices: ModelChoice[];
  unavailable: string[];
  pending: string[];
  at: number;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Drop the brand prefix from a model label, the way the prompt input does once
 * the provider is already named beside the model.
 */
export function stripModelBrandPrefix(
  label: string,
  providerId: string,
): string {
  if (providerId.startsWith("claude")) return label.replace(/^Claude\s+/i, "");
  if (providerId.startsWith("codex")) return label.replace(/^GPT-/i, "");
  return label;
}

export function createCatalogCache(bb: BbPluginApi) {
  let snapshot: CatalogSnapshot | null = null;
  let discovery: Promise<void> | null = null;
  let waiting: (() => void)[] = [];

  function wake() {
    const woken = waiting;
    waiting = [];
    for (const resolve of woken) resolve();
  }

  async function publish(next: CatalogSnapshot) {
    snapshot = next;
    wake();
    try {
      await bb.storage.kv.set(CATALOG_KEY, next);
      bb.realtime.publish(CATALOG_CHANNEL, { pending: next.pending.length });
    } catch (error) {
      bb.log.debug(`could not store the catalogue: ${describeError(error)}`);
    }
  }

  function discover(): Promise<void> {
    discovery ??= runDiscovery(bb, () => snapshot, publish).finally(() => {
      discovery = null;
      wake();
    });
    return discovery;
  }

  return {
    async read(
      refresh: boolean,
    ): Promise<Omit<CatalogSnapshot, "at"> & { discovering: boolean }> {
      snapshot ??= (await bb.storage.kv.get<CatalogSnapshot>(CATALOG_KEY)) ?? null;
      const stale =
        snapshot === null || Date.now() - snapshot.at > CATALOG_TTL_MS;
      if (refresh || stale) {
        const round = discover();
        round.catch((error: unknown) =>
          bb.log.warn(`model discovery failed: ${describeError(error)}`),
        );
        if (snapshot === null) {
          await Promise.race([
            new Promise<void>((resolve) => waiting.push(resolve)),
            round,
          ]);
        }
      }
      if (snapshot === null) {
        throw new Error("No agent reported any models.");
      }
      return {
        choices: snapshot.choices,
        unavailable: snapshot.unavailable,
        pending: snapshot.pending,
        discovering: discovery !== null,
      };
    },
  };
}

async function runDiscovery(
  bb: BbPluginApi,
  current: () => CatalogSnapshot | null,
  publish: (next: CatalogSnapshot) => Promise<void>,
): Promise<void> {
  const providers = (await bb.sdk.providers.list()).filter(
    (provider) => provider.available,
  );
  const previous = current()?.choices ?? [];
  const answered = new Map<string, ModelChoice[]>();
  const unavailable: string[] = [];
  let pending = providers.map((provider) => provider.displayName);

  const publishRound = () => {
    const collected = providers.flatMap(
      (provider) => answered.get(provider.id) ?? [],
    );
    return publish({
      choices: previous.length > 0 && pending.length > 0 ? previous : collected,
      unavailable: [...unavailable],
      pending: [...pending],
      at: Date.now(),
    });
  };

  await publishRound();
  await Promise.all(
    providers.map(async (provider) => {
      const choices = await providerChoices(bb, provider);
      if (choices === null) unavailable.push(provider.displayName);
      else answered.set(provider.id, choices);
      pending = pending.filter((name) => name !== provider.displayName);
      await publishRound();
    }),
  );
}

async function providerChoices(
  bb: BbPluginApi,
  provider: { id: string; displayName: string },
): Promise<ModelChoice[] | null> {
  let options;
  try {
    options = await bb.sdk.providers.models({ providerId: provider.id });
  } catch (error) {
    bb.log.debug(`no models for ${provider.id}: ${describeError(error)}`);
    return null;
  }
  if (options.modelLoadError !== null) return null;

  const toChoice = (
    entry: { model: string; displayName: string; description: string },
    extra: boolean,
  ): ModelChoice => ({
    providerId: provider.id,
    providerName: provider.displayName,
    model: entry.model,
    label: stripModelBrandPrefix(entry.displayName, provider.id),
    description: entry.description.slice(0, 160),
    extra,
  });
  const choices = options.models.map((entry) => toChoice(entry, false));
  for (const entry of options.selectedOnlyModels) {
    if (options.models.some((listed) => listed.model === entry.model)) continue;
    choices.push(toChoice(entry, true));
  }
  return choices;
}

/* ------------------------------------------------------------------ */
/* Target resolution                                                   */
/* ------------------------------------------------------------------ */

interface CommitGenTarget {
  projectId: string;
  providerId?: string;
  model?: string;
  environmentId: string | null;
}

export async function resolveCommitTarget(
  bb: BbPluginApi,
  rootKey: string,
  selection: AgentSelection | null,
): Promise<CommitGenTarget> {
  const sep = rootKey.indexOf(":");
  if (sep === -1) {
    throw new Error("Invalid root key.");
  }
  const kind = rootKey.slice(0, sep);
  const id = rootKey.slice(sep + 1);

  if (kind === "thread") {
    const thread = await bb.sdk.threads.get({ threadId: id });
    if (thread.environmentId === null) {
      throw new Error("This thread has no environment to run the agent in.");
    }
    if (selection !== null) {
      return {
        projectId: thread.projectId,
        environmentId: thread.environmentId,
        ...selection,
      };
    }
    const execution = await bb.sdk.threads
      .defaultExecutionOptions({ threadId: id })
      .catch(() => null);
    return {
      projectId: thread.projectId,
      environmentId: thread.environmentId,
      ...(execution ? { providerId: thread.providerId, model: execution.model } : {}),
    };
  }

  if (kind === "source") {
    const projects = await bb.sdk.projects.list({ includePersonal: true });
    let projectId: string | null = null;
    for (const project of projects) {
      if (project.kind === "personal") continue;
      if (project.sources.some((source) => source.id === id)) {
        projectId = project.id;
        break;
      }
    }
    if (projectId === null) {
      throw new Error("The project for this workspace is not available.");
    }
    if (selection !== null) {
      return {
        projectId,
        environmentId: await latestEnvironmentId(bb, projectId),
        ...selection,
      };
    }
    const defaults = await bb.sdk.projects
      .defaultExecutionOptions({ projectId })
      .catch(() => null);
    return {
      projectId,
      environmentId: await latestEnvironmentId(bb, projectId),
      ...(defaults ? { providerId: defaults.providerId, model: defaults.model } : {}),
    };
  }

  throw new Error("Unknown root key kind.");
}

/** An environment already provisioned in the project, so the generated thread
 *  reuses it rather than creating a worktree of its own. */
async function latestEnvironmentId(
  bb: BbPluginApi,
  projectId: string,
): Promise<string | null> {
  const threads = await bb.sdk.threads
    .list({ projectId, limit: 20 })
    .catch(() => []);
  return threads.find((thread) => thread.environmentId)?.environmentId ?? null;
}

async function restrictedPermissionMode(
  bb: BbPluginApi,
  providerId: string | undefined,
): Promise<PermissionMode | null> {
  if (providerId === undefined) return null;
  const providers = await bb.sdk.providers.list().catch(() => []);
  const supported = providers.find((provider) => provider.id === providerId)
    ?.capabilities.permissionModes;
  if (supported === undefined) return null;
  return (
    PERMISSION_MODE_PREFERENCE.find((mode) => supported.includes(mode)) ?? null
  );
}

/* ------------------------------------------------------------------ */
/* Thread runner                                                       */
/* ------------------------------------------------------------------ */

export async function runCommitMessageThread(
  bb: BbPluginApi,
  target: CommitGenTarget,
  prompt: string,
  timeoutMs: number,
): Promise<string | null> {
  const permissionMode = await restrictedPermissionMode(bb, target.providerId);
  const worker = await bb.sdk.threads.spawn({
    projectId: target.projectId,
    environment:
      target.environmentId === null
        ? { type: "project-default" }
        : { type: "reuse", environmentId: target.environmentId },
    prompt,
    title: "Generate commit message",
    visibility: "hidden",
    ...(target.providerId ? { providerId: target.providerId } : {}),
    ...(target.model ? { model: target.model } : {}),
    ...(permissionMode ? { permissionMode } : {}),
    executionInputSources: {
      ...(target.providerId ? { providerId: "explicit" as const } : {}),
      ...(target.model ? { model: "explicit" as const } : {}),
      ...(permissionMode ? { permissionMode: "explicit" as const } : {}),
    },
  });

  try {
    let completed;
    try {
      completed = await bb.sdk.threads.wait({
        threadId: worker.id,
        event: "turn/completed",
        timeoutMs,
      });
    } catch (error) {
      const thread = await bb.sdk.threads
        .get({ threadId: worker.id })
        .catch(() => null);
      throw thread?.status === "error"
        ? new Error("The agent stopped with an error.")
        : new Error(
            `The agent did not answer within ${Math.round(timeoutMs / 1000)}s (${describeError(error)}).`,
          );
    }

    const event = "event" in completed ? completed.event : null;
    if (event?.type === "turn/completed" && event.data.status !== "completed") {
      const detail = event.data.error?.message;
      throw new Error(
        detail !== undefined
          ? `The agent failed: ${detail}`
          : event.data.status === "interrupted"
            ? "The agent was interrupted."
            : "The agent stopped without answering.",
      );
    }

    const { output } = await bb.sdk.threads.output({ threadId: worker.id });
    return output;
  } finally {
    await bb.sdk.threads
      .stop({ threadId: worker.id })
      .catch((error: unknown) =>
        bb.log.warn(`could not stop ${worker.id}: ${describeError(error)}`),
      );
    await bb.sdk.threads
      .delete({ threadId: worker.id, childThreadsConfirmed: true })
      .catch(async (error: unknown) => {
        bb.log.warn(`could not delete ${worker.id}: ${describeError(error)}`);
        await bb.sdk.threads.archive({ threadId: worker.id }).catch(() => {});
      });
  }
}

/* ------------------------------------------------------------------ */
/* KV helpers                                                          */
/* ------------------------------------------------------------------ */

export const COMMIT_SELECTION_KEY = SELECTION_KEY;
