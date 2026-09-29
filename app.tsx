import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { GitRail } from "@/components/GitRail";
import { GitHeaderAction } from "@/components/GitHeaderAction";
import { toggleRailOpen, writeStoredOpen } from "@/lib/rail-state";

export default definePluginApp((app) => {
  app.slots.experimental_appOverlay({ id: "global-git-panel", component: GitRail });

  app.slots.experimental_threadHeaderAction({
    id: "git-panel-toggle",
    title: "Git",
    component: () => <GitHeaderAction />,
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
});
