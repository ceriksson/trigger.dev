import { useEffect, useMemo, useRef, useState } from "react";
import { useTypedFetcher } from "remix-typedjson";
import {
  createRefreshPath,
  createRootViewSnapshot,
  createRunsRefreshPath,
  getCurrentBackgroundRunsData,
  type RefreshRequestKind,
  type RefreshRunsData,
  type RootViewSnapshot,
} from "~/hooks/runsLiveRefresh.shared";
import { useAutoRevalidate } from "~/hooks/useAutoRevalidate";
import { useOptimisticLocation } from "~/hooks/useOptimisticLocation";
import { useSearchParams } from "~/hooks/useSearchParam";

const defaultPaginatedPollIntervalMs = 10_000;
const defaultRootPollIntervalMs = 10_000;

type RunsListShape<TRun extends { friendlyId: string; createdAt: Date | string }> = {
  runs: TRun[];
  pagination: {
    previous?: string | null;
  };
};

type UseRunsLiveRefreshOptions<
  TRun extends { friendlyId: string; createdAt: Date | string },
  TList extends RunsListShape<TRun>
> = {
  list: TList;
  organizationSlug: string;
  projectSlug: string;
  environmentSlug: string;
  paginatedPollInterval?: number;
  rootPollInterval?: number;
};

type RootOverride<
  TRun extends { friendlyId: string; createdAt: Date | string },
  TList extends RunsListShape<TRun>
> = {
  runs: TList["runs"];
  pagination?: TList["pagination"];
};

export function useRunsLiveRefresh<
  TRun extends { friendlyId: string; createdAt: Date | string },
  TList extends RunsListShape<TRun>
>({
  list,
  organizationSlug,
  projectSlug,
  environmentSlug,
  paginatedPollInterval = defaultPaginatedPollIntervalMs,
  rootPollInterval = defaultRootPollIntervalMs,
}: UseRunsLiveRefreshOptions<TRun, TList>) {
  const { has, value } = useSearchParams();
  const isRootEquivalentView =
    !has("cursor") || (value("direction") === "backward" && !list.pagination.previous);
  const autoRevalidator = useAutoRevalidate({
    interval: paginatedPollInterval,
    onFocus: true,
    disabled: isRootEquivalentView,
  });
  const backgroundRunsFetcher = useTypedFetcher<RefreshRunsData<TRun>>();
  const manualRefreshFetcher = useTypedFetcher<RefreshRunsData<TRun>>();
  const location = useOptimisticLocation();
  const [isRefreshingLatest, setIsRefreshingLatest] = useState(false);
  const [backgroundError, setBackgroundError] = useState<string>();
  const [manualRefreshError, setManualRefreshError] = useState<string>();
  const refreshPath = useMemo(() => {
    return createRefreshPath(location.pathname, location.search);
  }, [location.pathname, location.search]);
  // Root views keep a client snapshot so background polling can update the visible rows
  // without shifting the first page underneath the user.
  const { rootOverride, rootViewSnapshot, setRootOverride, setRootViewSnapshot } = useRootViewState<
    TRun,
    TList
  >({
    isRootEquivalentView,
    refreshPath,
    runs: list.runs,
  });

  // Clear any prior refresh errors when the user switches between root and paginated views,
  // or when the effective root-view filters change.
  useEffect(() => {
    if (!isRootEquivalentView) {
      setBackgroundError(undefined);
      setManualRefreshError(undefined);
      return;
    }

    setBackgroundError(undefined);
    setManualRefreshError(undefined);
  }, [isRootEquivalentView, refreshPath]);

  const currentSnapshotKey = rootViewSnapshot?.snapshotKey;

  const backgroundRunsPath = useMemo(() => {
    if (!isRootEquivalentView || !rootViewSnapshot || rootViewSnapshot.visibleRunIds.length === 0) {
      return undefined;
    }

    return createRunsRefreshPath({
      environmentSlug,
      organizationSlug,
      projectSlug,
      requestKind: "background",
      search: location.search,
      snapshot: rootViewSnapshot,
    });
  }, [
    environmentSlug,
    isRootEquivalentView,
    location.search,
    organizationSlug,
    projectSlug,
    rootViewSnapshot,
  ]);

  const manualRefreshPath = useMemo(() => {
    if (!isRootEquivalentView) {
      return undefined;
    }

    return createRunsRefreshPath({
      environmentSlug,
      organizationSlug,
      projectSlug,
      requestKind: "manual",
      search: location.search,
    });
  }, [environmentSlug, isRootEquivalentView, location.search, organizationSlug, projectSlug]);

  useAutoLoad({
    path: backgroundRunsPath,
    load: backgroundRunsFetcher.load,
    state: backgroundRunsFetcher.state,
    interval: rootPollInterval,
    onFocus: true,
  });

  // Reflect the latest background polling result into the background error state.
  useEffect(() => {
    const data = backgroundRunsFetcher.data;
    if (!data) {
      return;
    }

    if (!data.ok) {
      setBackgroundError(data.error);
      return;
    }

    setBackgroundError(undefined);
  }, [backgroundRunsFetcher.data]);

  // Apply the manual refresh payload as the new root list snapshot, or surface its error.
  useEffect(() => {
    const data = manualRefreshFetcher.data;
    if (!data) {
      return;
    }

    if (!data.ok) {
      setManualRefreshError(data.error);
      setIsRefreshingLatest(false);
      return;
    }

    setManualRefreshError(undefined);
    setBackgroundError(undefined);
    setRootOverride({
      runs: data.runs,
      pagination: data.pagination as TList["pagination"] | undefined,
    });
    setRootViewSnapshot(createRootViewSnapshot(data.runs));
    setIsRefreshingLatest(false);
  }, [manualRefreshFetcher.data]);

  const currentBackgroundRunsData = getCurrentBackgroundRunsData(
    backgroundRunsFetcher.data,
    currentSnapshotKey
  );
  const rootList = rootOverride
    ? { ...list, runs: rootOverride.runs, pagination: rootOverride.pagination ?? list.pagination }
    : list;
  // Manual refresh replaces the root list immediately. Background refresh only swaps in rows
  // that still match the current snapshot, so stale poll responses cannot overwrite newer state.
  const visibleRuns: TRun[] =
    isRootEquivalentView && !isRefreshingLatest && currentBackgroundRunsData?.runs
      ? currentBackgroundRunsData.runs
      : rootList.runs;
  const visibleList: TList = isRootEquivalentView
    ? ({ ...rootList, runs: visibleRuns } as TList)
    : list;

  return {
    hasNewRuns: isRootEquivalentView && (currentBackgroundRunsData?.newRunsCount ?? 0) > 0,
    backgroundError,
    isBackgroundRefreshing: isRootEquivalentView
      ? backgroundRunsFetcher.state === "loading"
      : autoRevalidator.state === "loading",
    isRefreshingLatest,
    isRootEquivalentView,
    manualRefreshError,
    newRunsCount: isRootEquivalentView ? currentBackgroundRunsData?.newRunsCount ?? 0 : 0,
    refreshLatest: () => {
      if (!manualRefreshPath) {
        return;
      }

      setManualRefreshError(undefined);
      setIsRefreshingLatest(true);
      manualRefreshFetcher.load(manualRefreshPath);
    },
    visibleList,
    visibleRuns,
  };
}

function useRootViewState<
  TRun extends { friendlyId: string; createdAt: Date | string },
  TList extends RunsListShape<TRun>
>({
  isRootEquivalentView,
  refreshPath,
  runs,
}: {
  isRootEquivalentView: boolean;
  refreshPath: string;
  runs: TRun[];
}) {
  const [rootOverride, setRootOverride] = useState<RootOverride<TRun, TList>>();
  const [rootViewSnapshot, setRootViewSnapshot] = useState<RootViewSnapshot | undefined>(() =>
    isRootEquivalentView ? createRootViewSnapshot(runs) : undefined
  );
  const previousRefreshPathRef = useRef<string>();

  // Maintain a root-view snapshot from the current list unless a manual refresh override is active.
  useEffect(() => {
    if (!isRootEquivalentView) {
      setRootViewSnapshot(undefined);
      setRootOverride(undefined);
      return;
    }

    if (rootOverride) {
      return;
    }

    setRootViewSnapshot(createRootViewSnapshot(runs));
  }, [isRootEquivalentView, rootOverride, runs]);

  // Reset snapshot state when the root-view route or filters change.
  useEffect(() => {
    if (previousRefreshPathRef.current === refreshPath) {
      return;
    }

    // Any filter or route change invalidates the captured root snapshot and manual override.
    previousRefreshPathRef.current = refreshPath;
    setRootOverride(undefined);

    if (isRootEquivalentView) {
      setRootViewSnapshot(createRootViewSnapshot(runs));
    }
  }, [isRootEquivalentView, refreshPath, runs]);

  return {
    rootOverride,
    rootViewSnapshot,
    setRootOverride,
    setRootViewSnapshot,
  };
}
function useAutoLoad({
  path,
  load,
  state,
  interval = 5_000,
  onFocus = true,
  disabled = false,
}: {
  path?: string;
  load: (href: string) => void;
  state: "idle" | "loading" | "submitting";
  interval?: number;
  onFocus?: boolean;
  disabled?: boolean;
}) {
  const loadRef = useRef(load);
  const pathRef = useRef(path);
  const stateRef = useRef(state);

  // Keep the timer and focus handlers reading the latest load callback, path, and fetcher state.
  useEffect(() => {
    loadRef.current = load;
    pathRef.current = path;
    stateRef.current = state;
  }, [load, path, state]);

  // Poll on an interval, but only while the page is visible and the previous request is idle.
  useEffect(() => {
    if (!path || !interval || interval <= 0 || disabled) return;

    const autoLoad = () => {
      if (
        !pathRef.current ||
        document.visibilityState !== "visible" ||
        stateRef.current !== "idle"
      ) {
        return;
      }

      loadRef.current(pathRef.current);
    };

    const intervalId = window.setInterval(autoLoad, interval);
    return () => window.clearInterval(intervalId);
  }, [path, interval, disabled]);

  // Trigger the same guarded auto-load when the tab becomes visible or the window regains focus.
  useEffect(() => {
    if (!path || !onFocus || disabled) return;

    const handleFocus = () => {
      if (
        !pathRef.current ||
        document.visibilityState !== "visible" ||
        stateRef.current !== "idle"
      ) {
        return;
      }

      loadRef.current(pathRef.current);
    };

    document.addEventListener("visibilitychange", handleFocus);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleFocus);
      window.removeEventListener("focus", handleFocus);
    };
  }, [path, onFocus, disabled]);
}
