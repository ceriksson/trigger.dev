export type RefreshRequestKind = "background" | "manual";

export type RootViewSnapshot = {
  visibleRunIds: string[];
  latestCreatedAt?: string;
  snapshotKey: string;
};

export type RefreshRunsData<TRun> =
  | {
      ok: true;
      mode: RefreshRequestKind;
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
      mode: RefreshRequestKind;
      error: string;
      snapshotKey?: string;
    };

export function createRootViewSnapshot<TRun extends { friendlyId: string; createdAt: Date | string }>(
  runs: TRun[]
): RootViewSnapshot | undefined {
  if (runs.length === 0) {
    return undefined;
  }

  return {
    visibleRunIds: runs.map((run) => run.friendlyId),
    latestCreatedAt: getLatestCreatedAt(runs),
    snapshotKey: runs.map((run) => run.friendlyId).join(","),
  };
}

export function createRefreshPath(pathname: string, search: string) {
  const searchParams = createBaseRunsSearchParams(search);
  const query = searchParams.toString();

  return `${pathname}${query ? `?${query}` : ""}`;
}

export function createRunsRefreshPath({
  environmentSlug,
  organizationSlug,
  projectSlug,
  requestKind,
  search,
  snapshot,
}: {
  environmentSlug: string;
  organizationSlug: string;
  projectSlug: string;
  requestKind: RefreshRequestKind;
  search: string;
  snapshot?: RootViewSnapshot;
}) {
  const searchParams = createBaseRunsSearchParams(search);
  searchParams.set("requestKind", requestKind);

  if (snapshot) {
    if (snapshot.latestCreatedAt) {
      searchParams.set("latestCreatedAt", snapshot.latestCreatedAt);
    }

    searchParams.set("snapshotKey", snapshot.snapshotKey);

    for (const runId of snapshot.visibleRunIds) {
      searchParams.append("visibleRunId", runId);
    }
  }

  return `/resources/orgs/${organizationSlug}/projects/${projectSlug}/env/${environmentSlug}/runs/new?${searchParams.toString()}`;
}

export function getCurrentBackgroundRunsData<TRun>(
  data: RefreshRunsData<TRun> | undefined,
  currentSnapshotKey: string | undefined
): Extract<RefreshRunsData<TRun>, { ok: true }> | undefined {
  if (!data || !data.ok) {
    return undefined;
  }

  return data.snapshotKey === currentSnapshotKey ? data : undefined;
}

function createBaseRunsSearchParams(search: string) {
  const searchParams = new URLSearchParams(search);
  searchParams.delete("cursor");
  searchParams.delete("direction");

  return searchParams;
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
