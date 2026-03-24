import { useEffect, useMemo, useRef, useState } from "react";
import { useTypedFetcher } from "remix-typedjson";
import { useAutoRevalidate } from "~/hooks/useAutoRevalidate";
import { useOptimisticLocation } from "~/hooks/useOptimisticLocation";
import { useSearchParams } from "~/hooks/useSearchParam";

const defaultPaginatedPollIntervalMs = 10_000;
const defaultRootPollIntervalMs = 10_000;

type RefreshRunsData<TRun> =
  | {
      ok: true;
      mode: "background" | "manual";
      runs: TRun[];
      hasNewRuns: boolean;
      newRunsCount: number;
      snapshotKey?: string;
      pagination?: {
        next?: string | null;
        previous?: string | null;
      };
    }
  | {
      ok: false;
      mode: "background" | "manual";
      error: string;
      snapshotKey?: string;
    };

type RunsListShape<TRun extends { friendlyId: string; createdAt: Date | string }> = {
  runs: TRun[];
  pagination: {
    previous?: string | null;
  };
};

type UseRunsLiveRefreshOptions<
  TRun extends { friendlyId: string; createdAt: Date | string },
  TList extends RunsListShape<TRun>,
> = {
  list: TList;
  organizationSlug: string;
  projectSlug: string;
  environmentSlug: string;
  paginatedPollInterval?: number;
  rootPollInterval?: number;
};

export function useRunsLiveRefresh<
  TRun extends { friendlyId: string; createdAt: Date | string },
  TList extends RunsListShape<TRun>,
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
  const [rootOverride, setRootOverride] = useState<{
    runs: TRun[];
    pagination?: TList["pagination"];
  }>();
  const previousRefreshPathRef = useRef<string>();
  // Keep a client-side snapshot of the root view so background polling can refresh the
  // visible rows without shifting the first page underneath the user.
  const [rootViewSnapshot, setRootViewSnapshot] = useState(() =>
    isRootEquivalentView ? createRootViewSnapshot(list.runs) : undefined
  );
  const currentSnapshotKey = rootViewSnapshot?.snapshotKey;

  useEffect(() => {
    if (!isRootEquivalentView) {
      setRootViewSnapshot(undefined);
      setRootOverride(undefined);
      setBackgroundError(undefined);
      setManualRefreshError(undefined);
      return;
    }

    if (rootOverride) {
      return;
    }

    setRootViewSnapshot(createRootViewSnapshot(list.runs));
  }, [isRootEquivalentView, list.runs, rootOverride]);

  const refreshPath = useMemo(() => {
    const searchParams = new URLSearchParams(location.search);
    searchParams.delete("cursor");
    searchParams.delete("direction");

    const query = searchParams.toString();
    return `${location.pathname}${query ? `?${query}` : ""}`;
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (previousRefreshPathRef.current === refreshPath) {
      return;
    }

    previousRefreshPathRef.current = refreshPath;
    setRootOverride(undefined);
    setBackgroundError(undefined);
    setManualRefreshError(undefined);

    if (isRootEquivalentView) {
      setRootViewSnapshot(createRootViewSnapshot(list.runs));
    }
  }, [refreshPath, isRootEquivalentView, list.runs]);

  const backgroundRunsPath = useMemo(() => {
    if (!isRootEquivalentView || !rootViewSnapshot || rootViewSnapshot.visibleRunIds.length === 0) {
      return undefined;
    }

    const searchParams = new URLSearchParams(location.search);
    searchParams.delete("cursor");
    searchParams.delete("direction");

    if (rootViewSnapshot.latestCreatedAt) {
      searchParams.set("latestCreatedAt", rootViewSnapshot.latestCreatedAt);
    }

    searchParams.set("requestKind", "background");
    searchParams.set("snapshotKey", rootViewSnapshot.snapshotKey);

    for (const runId of rootViewSnapshot.visibleRunIds) {
      searchParams.append("visibleRunId", runId);
    }

    return `/resources/orgs/${organizationSlug}/projects/${projectSlug}/env/${environmentSlug}/runs/new?${searchParams.toString()}`;
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

    const searchParams = new URLSearchParams(location.search);
    searchParams.delete("cursor");
    searchParams.delete("direction");
    searchParams.set("requestKind", "manual");

    return `/resources/orgs/${organizationSlug}/projects/${projectSlug}/env/${environmentSlug}/runs/new?${searchParams.toString()}`;
  }, [environmentSlug, isRootEquivalentView, location.search, organizationSlug, projectSlug]);

  useAutoLoad({
    path: backgroundRunsPath,
    load: backgroundRunsFetcher.load,
    state: backgroundRunsFetcher.state,
    interval: rootPollInterval,
    onFocus: true,
  });

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

  const backgroundRunsData: Extract<RefreshRunsData<TRun>, { ok: true }> | undefined =
    backgroundRunsFetcher.data && backgroundRunsFetcher.data.ok
      ? backgroundRunsFetcher.data
      : undefined;
  // Ignore background results that were produced for an older root-view snapshot.
  const currentBackgroundRunsData =
    backgroundRunsData?.snapshotKey === currentSnapshotKey ? backgroundRunsData : undefined;
  const rootList = rootOverride
    ? { ...list, runs: rootOverride.runs, pagination: rootOverride.pagination ?? list.pagination }
    : list;
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

function createRootViewSnapshot<TRun extends { friendlyId: string; createdAt: Date | string }>(
  runs: TRun[]
) {
  if (runs.length === 0) {
    return undefined;
  }

  return {
    visibleRunIds: runs.map((run) => run.friendlyId),
    latestCreatedAt: getLatestCreatedAt(runs),
    snapshotKey: runs.map((run) => run.friendlyId).join(","),
  };
}

function serializeRunCreatedAt(createdAt: Date | string) {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function getLatestCreatedAt<TRun extends { createdAt: Date | string }>(runs: TRun[]) {
  let latestCreatedAt: string | undefined;
  let latestCreatedAtMs = Number.NEGATIVE_INFINITY;

  for (const run of runs) {
    const serializedCreatedAt = serializeRunCreatedAt(run.createdAt);
    if (!serializedCreatedAt) continue;

    const createdAtMs = Date.parse(serializedCreatedAt);
    if (!Number.isFinite(createdAtMs) || createdAtMs <= latestCreatedAtMs) {
      continue;
    }

    latestCreatedAt = serializedCreatedAt;
    latestCreatedAtMs = createdAtMs;
  }

  return latestCreatedAt;
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

  useEffect(() => {
    loadRef.current = load;
    pathRef.current = path;
    stateRef.current = state;
  }, [load, path, state]);

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
