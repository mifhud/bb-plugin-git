import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { AgentPicker } from "@/components/AgentPicker";
import { GitDiffPanel } from "@/components/GitDiffPanel";
import { GitHeaderAction } from "@/components/GitHeaderAction";
import { GitRail } from "@/components/GitRail";
import { NewThreadGitAction } from "@/components/NewThreadGitAction";
import { GIT_DIFF_ACTION_ID } from "@/lib/open-diff-panel";
import { toggleRailOpen, writeStoredOpen } from "@/lib/rail-state";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "global-git-panel", component: GitRail });

  app.slots.experimental_threadHeaderAction({
    id: "git-panel-toggle",
    title: "Git",
    component: ({ threadId }) => <GitHeaderAction threadId={threadId} />,
  });

  // A file's diff opens as a tab in BB's built-in side panel instead of the
  // rail's own drawer (which stays as the fallback). `flush` lets `DiffView`
  // own its padding and scrolling.
  app.slots.threadPanelAction({
    id: GIT_DIFF_ACTION_ID,
    title: "Git Diff",
    component: GitDiffPanel,
    layout: "flush",
  });

  // The same diff tab is also offered on the New Thread (root compose) screen,
  // whose panel launcher uses experimental_newThreadPanelAction — the
  // threadPanelAction slot is thread-only and not rendered there.
  app.slots.experimental_newThreadPanelAction({
    id: GIT_DIFF_ACTION_ID,
    title: "Git Diff",
    component: GitDiffPanel,
    layout: "flush",
  });

  app.slots.sidebarFooterAction({
    id: "git-panel-toggle",
    title: "Git",
    icon: "GitBranch",
    run: toggleRailOpen,
  });

  app.slots.commandPaletteAction({
    id: "open-git-panel",
    title: "Git: show panel",
    run: () => writeStoredOpen(true),
  });

  app.slots.commandPaletteAction({
    id: "hide-git-panel",
    title: "Git: hide panel",
    run: () => writeStoredOpen(false),
  });

  // A git icon in the New Thread composer's action strip, mirroring
  // bb-plugin-file-explorer's NewThreadFileExplorerAction. Toggles the rail.
  app.composer.customize({
    id: "new-thread-git",
    scopes: ["new-thread"],
    actions: [{ id: "open-git-panel", component: NewThreadGitAction }],
  });

  app.slots.settingsSection({
    id: "commit-agent",
    title: "Commit message agent",
    description:
      "Which agent generates commit messages from staged changes. Pick a model to always use that one, or keep the project default.",
    component: AgentPicker,
  });
});
