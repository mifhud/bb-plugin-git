import path from "node:path";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { RootChoice, WorkspaceResult } from "../contract";
import { registerRoot } from "./roots.ts";

/**
 * Resolves the working folder the Git panel operates on: a thread's
 * environment checkout, or a project source when no thread exists yet.
 * Ported from bb-plugin-file-tree's workspace module, without the personal
 * thread root — git needs a checkout, and a personal thread has none.
 */
export async function workspaceForThread(
  bb: BbPluginApi,
  threadId: string,
): Promise<WorkspaceResult> {
  const thread = await bb.sdk.threads.get({ threadId });
  if (thread.environmentId === null) {
    return { ok: false, reason: "no_environment" };
  }
  const environment = await bb.sdk.environments.get({
    environmentId: thread.environmentId,
  });
  if (environment.path === null || environment.path === "") {
    return { ok: false, reason: "no_checkout" };
  }
  return {
    ok: true,
    workspace: {
      environmentId: environment.id,
      hostId: environment.hostId,
      rootPath: environment.path,
      rootName: path.basename(environment.path) || environment.path,
      rootId: registerRoot(environment.hostId, environment.path),
    },
  };
}

/** A root composer has selected a project but no thread or environment yet. */
export async function workspaceForProject(
  bb: BbPluginApi,
  projectId: string,
): Promise<WorkspaceResult> {
  const projects = await bb.sdk.projects.list({ includePersonal: true });
  const project = projects.find((candidate) => candidate.id === projectId);
  if (project === undefined) return { ok: false, reason: "no_checkout" };
  const source = project.sources.find((candidate) => candidate.isDefault) ?? project.sources[0];
  if (source === undefined) return { ok: false, reason: "no_checkout" };
  return {
    ok: true,
    workspace: {
      environmentId: null,
      hostId: source.hostId,
      rootPath: source.path,
      rootName: path.basename(source.path) || source.path,
      rootId: registerRoot(source.hostId, source.path),
    },
  };
}

/** Roots offered by the pinned-root selector. IDs name durable BB records. */
export async function listRootChoices(
  bb: BbPluginApi,
  input: { currentThreadId: string | null; pinnedThreadId: string | null },
): Promise<RootChoice[]> {
  const projects = await bb.sdk.projects.list({ includePersonal: true });
  const choices: RootChoice[] = [];
  for (const project of projects) {
    if (project.kind === "personal") continue; // personal threads have no checkout
    for (const source of project.sources) {
      choices.push({
        id: `source:${source.id}`,
        label: `${project.name} · ${source.path}`,
        projectId: project.id,
        workspace: {
          environmentId: null,
          hostId: source.hostId,
          rootPath: source.path,
          rootName: path.basename(source.path) || source.path,
          rootId: registerRoot(source.hostId, source.path),
        },
      });
    }
  }

  const threadIds = new Set(
    [input.currentThreadId, input.pinnedThreadId].filter((id): id is string => id !== null),
  );
  for (const threadId of threadIds) {
    try {
      const resolved = await workspaceForThread(bb, threadId);
      if (resolved.ok) {
        choices.unshift({
          id: `thread:${threadId}`,
          label: `Thread workspace · ${resolved.workspace.rootPath}`,
          projectId: null,
          workspace: resolved.workspace,
        });
      }
    } catch (cause) {
      bb.log.warn(
        `Could not load git root for thread ${threadId}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  return choices;
}
