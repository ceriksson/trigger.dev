import { ExclamationTriangleIcon } from "@heroicons/react/20/solid";
import { Button } from "~/components/primitives/Buttons";
import { Spinner } from "~/components/primitives/Spinner";
import { SimpleTooltip } from "~/components/primitives/Tooltip";
import { formatNumberCompact } from "~/utils/numberFormatter";

type RunsRefreshControlsProps = {
  backgroundError?: string;
  hasNewRuns: boolean;
  isBackgroundRefreshing: boolean;
  isRefreshingLatest: boolean;
  isRootEquivalentView: boolean;
  manualRefreshError?: string;
  newRunsCount: number;
  onRefresh: () => void;
};

export function RunsRefreshControls({
  backgroundError,
  hasNewRuns,
  isBackgroundRefreshing,
  isRefreshingLatest,
  isRootEquivalentView,
  manualRefreshError,
  newRunsCount,
  onRefresh,
}: RunsRefreshControlsProps) {
  const refreshButtonLabel = hasNewRuns
    ? `~${formatNumberCompact(newRunsCount)} new runs`
    : "No new runs";

  return (
    <>
      <div className="flex size-3.5 items-center justify-center">
        {manualRefreshError ? (
          <SimpleTooltip
            button={
              <ExclamationTriangleIcon
                data-testid="runs-refresh-status-icon-manual-error"
                className="size-4 text-text-dimmed/70"
              />
            }
            content={manualRefreshError}
          />
        ) : backgroundError ? (
          <SimpleTooltip
            button={
              <ExclamationTriangleIcon
                data-testid="runs-refresh-status-icon-background-error"
                className="size-4 text-text-dimmed/70"
              />
            }
            content={backgroundError}
          />
        ) : isBackgroundRefreshing || isRefreshingLatest ? (
          <Spinner className="size-3.5" color="muted" />
        ) : null}
      </div>
      {isRootEquivalentView ? (
        <Button
          variant={
            manualRefreshError
              ? "secondary/small"
              : hasNewRuns
              ? "primary/small"
              : "secondary/small"
          }
          disabled={!hasNewRuns || isRefreshingLatest}
          name="runs-refresh"
          shortcut={{ key: "n" }}
          className={
            manualRefreshError
              ? "border-error/30 bg-error/10 hover:!border-error/50 hover:!bg-error/20"
              : undefined
          }
          onClick={onRefresh}
        >
          {refreshButtonLabel}
        </Button>
      ) : null}
    </>
  );
}
