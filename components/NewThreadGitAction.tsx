import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { writeStoredOpen } from "@/lib/rail-state";

/**
 * A git icon button in the New Thread composer's action strip, mirroring
 * bb-plugin-file-explorer's `NewThreadFileExplorerAction`. Toggling opens
 * the Git rail so the composer author can see changes without leaving the
 * compose surface.
 */
export function NewThreadGitAction() {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7"
      aria-label="Show git panel"
      onClick={() => writeStoredOpen(true)}
    >
      <Icon name="GitBranch" className="size-4" />
    </Button>
  );
}
