import { type LoaderFunctionArgs } from "@remix-run/server-runtime";
import { typedjson } from "remix-typedjson";
import { $replica } from "~/db.server";
import { findProjectBySlug } from "~/models/project.server";
import { findEnvironmentBySlug } from "~/models/runtimeEnvironment.server";
import { getRunFiltersFromRequest } from "~/presenters/RunFilters.server";
import { NextRunListPresenter } from "~/presenters/v3/NextRunListPresenter.server";
import { clickhouseClient } from "~/services/clickhouseInstance.server";
import { RunsRepository } from "~/services/runsRepository/runsRepository.server";
import { requireUserId } from "~/services/session.server";
import { EnvironmentParamSchema } from "~/utils/pathBuilder";

const manualRefreshErrorMessage = "We couldn't load the latest runs. Please try again.";
const backgroundRefreshErrorMessage = "We couldn't refresh the current runs in view.";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const userId = await requireUserId(request);
  const { projectParam, organizationSlug, envParam } = EnvironmentParamSchema.parse(params);

  const project = await findProjectBySlug(organizationSlug, projectParam, userId);
  if (!project) {
    throw new Response("Not Found", { status: 404 });
  }

  const environment = await findEnvironmentBySlug(project.id, envParam, userId);
  if (!environment) {
    throw new Response("Not Found", { status: 404 });
  }

  const filters = await getRunFiltersFromRequest(request);
  const url = new URL(request.url);
  const requestKind = url.searchParams.get("requestKind") === "manual" ? "manual" : "background";
  const refreshFailureMode = url.searchParams.get("refreshFailureMode");
  const visibleRunIds = url.searchParams.getAll("visibleRunId").filter((value) => value.length > 0);
  const latestCreatedAt = url.searchParams.get("latestCreatedAt");
  const snapshotKey = url.searchParams.get("snapshotKey") ?? undefined;

  if (refreshFailureMode === requestKind || refreshFailureMode === "all") {
    return typedjson(
      {
        ok: false as const,
        error: getRefreshErrorMessage(requestKind),
        mode: requestKind,
        snapshotKey,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const presenter = new NextRunListPresenter($replica, clickhouseClient);

    if (requestKind === "manual") {
      const latestList = await presenter.call(project.organizationId, environment.id, {
        userId,
        projectId: project.id,
        ...filters,
      });

      return typedjson(
        {
          ok: true as const,
          mode: requestKind,
          runs: latestList.runs,
          pagination: latestList.pagination,
          hasNewRuns: false,
          newRunsCount: 0,
          snapshotKey: latestList.runs.map((run) => run.friendlyId).join(","),
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (visibleRunIds.length === 0) {
      return typedjson(
        {
          ok: true as const,
          mode: requestKind,
          runs: [],
          hasNewRuns: false,
          newRunsCount: 0,
          snapshotKey,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    // Re-fetch only the rows currently visible on the first page so the list stays stable
    // while background polling updates their latest state.
    const list = await presenter.call(project.organizationId, environment.id, {
      userId,
      projectId: project.id,
      ...filters,
      runId: visibleRunIds,
      pageSize: visibleRunIds.length,
    });

    const visibleRunIndex = new Map(visibleRunIds.map((runId, index) => [runId, index]));
    const runs = [...list.runs].sort((a, b) => {
      return (
        (visibleRunIndex.get(a.friendlyId) ?? Number.POSITIVE_INFINITY) -
        (visibleRunIndex.get(b.friendlyId) ?? Number.POSITIVE_INFINITY)
      );
    });

    let newRunsCount = 0;
    const latestCreatedAtMs = latestCreatedAt ? Date.parse(latestCreatedAt) : Number.NaN;

    if (!filters.cursor && Number.isFinite(latestCreatedAtMs)) {
      const { runId: ignoredRunIds, cursor, direction, ...restFilters } = filters;
      const runsRepository = new RunsRepository({
        clickhouse: clickhouseClient,
        prisma: $replica,
      });

      newRunsCount = await runsRepository.countRuns({
        organizationId: project.organizationId,
        projectId: project.id,
        environmentId: environment.id,
        ...restFilters,
        from: Math.max(restFilters.from ?? 0, latestCreatedAtMs + 1),
      });
    }

    return typedjson(
      {
        ok: true as const,
        mode: requestKind,
        runs,
        hasNewRuns: newRunsCount > 0,
        newRunsCount,
        snapshotKey,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return typedjson(
      {
        ok: false as const,
        error: error instanceof Error ? error.message : getRefreshErrorMessage(requestKind),
        mode: requestKind,
        snapshotKey,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}

function getRefreshErrorMessage(requestKind: "background" | "manual") {
  return requestKind === "manual" ? manualRefreshErrorMessage : backgroundRefreshErrorMessage;
}
