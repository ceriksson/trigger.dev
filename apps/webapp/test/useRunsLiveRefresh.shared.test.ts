import { describe, expect, it } from "vitest";
import {
  createRefreshPath,
  createRootViewSnapshot,
  createRunsRefreshPath,
  getCurrentBackgroundRunsData,
} from "~/hooks/runsLiveRefresh.shared";

describe("runsLiveRefresh.shared", () => {
  it("creates a root snapshot from the visible runs", () => {
    const snapshot = createRootViewSnapshot([
      { friendlyId: "run_1", createdAt: "2026-03-24T10:00:00.000Z" },
      { friendlyId: "run_2", createdAt: "2026-03-24T10:05:00.000Z" },
    ]);

    expect(snapshot).toEqual({
      visibleRunIds: ["run_1", "run_2"],
      latestCreatedAt: "2026-03-24T10:05:00.000Z",
      snapshotKey: "run_1,run_2",
    });
  });

  it("removes pagination params from refresh paths but keeps filters", () => {
    expect(
      createRefreshPath(
        "/orgs/test/projects/project/env/prod/runs",
        "?cursor=old&direction=forward&period=7d&status=COMPLETED"
      )
    ).toBe("/orgs/test/projects/project/env/prod/runs?period=7d&status=COMPLETED");
  });

  it("builds the background refresh resource path with snapshot details", () => {
    expect(
      createRunsRefreshPath({
        environmentSlug: "prod",
        organizationSlug: "test-org",
        projectSlug: "test-project",
        requestKind: "background",
        search: "?period=7d&cursor=old&direction=forward",
        snapshot: {
          visibleRunIds: ["run_1", "run_2"],
          latestCreatedAt: "2026-03-24T10:05:00.000Z",
          snapshotKey: "run_1,run_2",
        },
      })
    ).toBe(
      "/resources/orgs/test-org/projects/test-project/env/prod/runs/new?period=7d&requestKind=background&latestCreatedAt=2026-03-24T10%3A05%3A00.000Z&snapshotKey=run_1%2Crun_2&visibleRunId=run_1&visibleRunId=run_2"
    );
  });

  it("only accepts background data for the current snapshot", () => {
    expect(
      getCurrentBackgroundRunsData(
        {
          ok: true,
          mode: "background",
          runs: [{ friendlyId: "run_1", createdAt: "2026-03-24T10:00:00.000Z" }],
          hasNewRuns: true,
          newRunsCount: 3,
          snapshotKey: "snapshot-a",
        },
        "snapshot-a"
      )?.newRunsCount
    ).toBe(3);

    expect(
      getCurrentBackgroundRunsData(
        {
          ok: true,
          mode: "background",
          runs: [{ friendlyId: "run_1", createdAt: "2026-03-24T10:00:00.000Z" }],
          hasNewRuns: true,
          newRunsCount: 3,
          snapshotKey: "snapshot-a",
        },
        "snapshot-b"
      )
    ).toBeUndefined();
  });
});
