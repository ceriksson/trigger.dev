import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { RunEngineVersion, RuntimeEnvironmentType, TaskRunStatus } from "@trigger.dev/database";
import { createOrganization } from "../../apps/webapp/app/models/organization.server";
import { createProject } from "../../apps/webapp/app/models/project.server";
import { createPersonalAccessToken } from "../../apps/webapp/app/services/personalAccessToken.server";
import { setDB } from "../utils";

test.use({
  video: "on",
});

test.describe("Runs refresh", () => {
  test("shows a correct new-run count and refreshes only when newer rows exist", async ({
    page,
    request,
  }, testInfo) => {
    test.slow();

    const suffix = `${Date.now()}-${testInfo.workerIndex}`;
    const scenario = await createScenario(suffix);
    const refreshButton = page.locator('button[name="runs-refresh"]');

    try {
      await backfillRuns(request, scenario.adminToken, scenario.initialRunIds);

      await login(page, scenario.user.email, scenario.runsPath);

      await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("seed-base-24")).toBeVisible({ timeout: 30_000 });
      await expect(refreshButton).toBeDisabled();
      await expect(refreshButton).toContainText("No new runs");

      await page.screenshot({
        path: testInfo.outputPath("runs-refresh-initial.png"),
        fullPage: true,
      });

      const firstNewRunIds = await insertNewRuns(scenario, 2);
      await backfillRuns(request, scenario.adminToken, firstNewRunIds);

      await waitForRefreshPoll(page);

      await expect(refreshButton).toBeEnabled();
      await expect(refreshButton).toContainText("2");

      await page.screenshot({
        path: testInfo.outputPath("runs-refresh-count-first-interval.png"),
        fullPage: true,
      });

      const secondNewRunIds = await insertNewRuns(scenario, 2_000);
      await backfillRuns(request, scenario.adminToken, secondNewRunIds);

      await waitForRefreshPoll(page);

      await expect(refreshButton).toBeEnabled();
      await expect(refreshButton).toContainText("2K");

      await page.screenshot({
        path: testInfo.outputPath("runs-refresh-count.png"),
        fullPage: true,
      });

      await refreshButton.click();

      await expect(page.getByRole("link", { name: "seed-new-2002 Root" })).toBeVisible();
      await expect(page.getByRole("link", { name: "seed-new-1978 Root" })).toBeVisible();

      await page.screenshot({
        path: testInfo.outputPath("runs-refresh-after-click.png"),
        fullPage: true,
      });

      await waitForRefreshPoll(page);

      await expect(refreshButton).toBeDisabled();
      await expect(refreshButton).toContainText("No new runs");
      await expect(page.getByRole("link", { name: "seed-new-2002 Root" })).toBeVisible();
      await expect(page.getByRole("link", { name: "seed-new-1978 Root" })).toBeVisible();

      await page.screenshot({
        path: testInfo.outputPath("runs-refresh-settled.png"),
        fullPage: true,
      });
    } finally {
      await cleanupScenario(scenario);
    }
  });

  test("restores refresh on the root view after paging away and back, then shows 10 new runs", async ({
    page,
    request,
  }, testInfo) => {
    test.slow();

    const suffix = `${Date.now()}-${testInfo.workerIndex}`;
    const scenario = await createScenario(suffix, { initialRunCount: 36 });
    const refreshButton = page.locator('button[name="runs-refresh"]');

    try {
      await backfillRuns(request, scenario.adminToken, scenario.initialRunIds);

      await login(page, scenario.user.email, scenario.runsPath);

      await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible({ timeout: 30_000 });
      await expect(refreshButton).toBeVisible();
      await expect(refreshButton).toBeDisabled();
      await expect(refreshButton).toContainText("No new runs");
      await expect(page.getByText("seed-base-36")).toBeVisible({ timeout: 30_000 });

      await clickPaginationLink(page, "forward");
      await expect(page).toHaveURL(/direction=forward/);
      await expect(refreshButton).toHaveCount(0);

      await page.goto(scenario.runsPath);
      await expect(page).toHaveURL(scenario.runsPath);
      await expect(refreshButton).toBeVisible({ timeout: 15_000 });
      await expect(refreshButton).toBeDisabled();

      await page.screenshot({
        path: testInfo.outputPath("runs-refresh-pagination-returned.png"),
        fullPage: true,
      });

      const newRunIds = await insertNewRuns(scenario, 10);
      await backfillRuns(request, scenario.adminToken, newRunIds);

      await waitForRefreshPoll(page);

      await expect(refreshButton).toBeEnabled();
      await expect(refreshButton).toContainText("10");

      await page.screenshot({
        path: testInfo.outputPath("runs-refresh-pagination-count.png"),
        fullPage: true,
      });

      await refreshButton.click();

      await expect(page.getByRole("link", { name: "seed-new-10 Root" })).toBeVisible();
      await expect(page.getByRole("link", { name: "seed-new-1 Root" })).toBeVisible();

      await page.screenshot({
        path: testInfo.outputPath("runs-refresh-pagination-after-click.png"),
        fullPage: true,
      });

      await waitForRefreshPoll(page);

      await expect(refreshButton).toBeDisabled();
      await expect(refreshButton).not.toContainText("10");

      await page.screenshot({
        path: testInfo.outputPath("runs-refresh-pagination-settled.png"),
        fullPage: true,
      });
    } finally {
      await cleanupScenario(scenario);
    }
  });

  test("shows inline warning feedback for background and manual refresh failures", async ({
    page,
    request,
  }, testInfo) => {
    test.slow();

    const suffix = `${Date.now()}-${testInfo.workerIndex}`;
    const scenario = await createScenario(suffix);
    const refreshButton = page.locator('button[name="runs-refresh"]');

    try {
      await backfillRuns(request, scenario.adminToken, scenario.initialRunIds);

      await login(page, scenario.user.email, `${scenario.runsPath}?refreshFailureMode=background`);

      await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible({ timeout: 30_000 });
      await expect(refreshButton).toContainText("No new runs");

      await waitForRefreshPoll(page);

      const backgroundErrorIcon = page.getByTestId("runs-refresh-status-icon-background-error");
      await expect(backgroundErrorIcon).toBeVisible();
      await backgroundErrorIcon.hover();
      await expect(page.getByText("We couldn't refresh the current runs in view.")).toBeVisible();

      await page.screenshot({
        path: testInfo.outputPath("runs-refresh-background-error.png"),
        fullPage: true,
      });

      await page.goto(`${scenario.runsPath}?refreshFailureMode=manual`);
      await expect(page.getByRole("heading", { name: "Runs" })).toBeVisible({ timeout: 30_000 });
      await expect(refreshButton).toContainText("No new runs");

      const newRunIds = await insertNewRuns(scenario, 10);
      await backfillRuns(request, scenario.adminToken, newRunIds);

      await page.waitForTimeout(10_500);

      await expect(refreshButton).toBeEnabled();
      await expect(refreshButton).toContainText("10");

      await refreshButton.click();

      const manualErrorIcon = page.getByTestId("runs-refresh-status-icon-manual-error");
      await expect(manualErrorIcon).toBeVisible();
      await expect(refreshButton.locator("div").first()).toHaveClass(/border-error\/30/);

      await manualErrorIcon.hover();
      await expect(
        page.getByText("We couldn't load the latest runs. Please try again.")
      ).toBeVisible();

      await page.screenshot({
        path: testInfo.outputPath("runs-refresh-manual-error.png"),
        fullPage: true,
      });
    } finally {
      await cleanupScenario(scenario);
    }
  });
});

async function login(page: Page, email: string, redirectTo: string) {
  await page.goto(`/login?redirectTo=${encodeURIComponent(redirectTo)}`);
  await page.getByRole("link", { name: "Continue with Email" }).click();
  await page.getByPlaceholder("Email Address").fill(email);
  await page.getByRole("button", { name: "Send a magic link" }).click();
  await page.waitForLoadState("networkidle");
  await completeOnboardingIfPresent(page);
  await page.goto(redirectTo);
  await page.waitForLoadState("networkidle");
  await completeOnboardingIfPresent(page);
}

async function completeOnboardingIfPresent(page: Page) {
  if (page.url().includes("/confirm-basic-details")) {
    await page.getByLabel(/Full name/).fill("Test User");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.waitForLoadState("networkidle");
  }

  if (page.url().includes("/orgs/new")) {
    await page.getByLabel(/Organization name/).fill(`Playwright Org ${Date.now()}`);
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForLoadState("networkidle");
  }

  const createProjectHeading = page.getByRole("heading", { name: "Create a new project" });

  if (await createProjectHeading.isVisible().catch(() => false)) {
    await page.getByLabel(/Project name/).fill(`Playwright Project ${Date.now()}`);
    await page.getByRole("button", { name: "Create" }).click();
    await page.waitForLoadState("networkidle");
  }
}

type Scenario = {
  organization: {
    slug: string;
  };
  project: {
    slug: string;
  };
  environment: {
    id: string;
    slug: string;
  };
  user: {
    email: string;
  };
  personalAccessTokenId: string;
  adminToken: string;
  initialRunIds: string[];
  runsPath: string;
};

async function clickPaginationLink(page: Page, direction: "forward" | "backward") {
  const paginationLink = page.locator(`a[href*="direction=${direction}"]`).first();
  await expect(paginationLink).toBeVisible();
  await paginationLink.click();
}

async function waitForRefreshPoll(page: Page) {
  // The runs view polls every 10s, so wait just past the interval to observe the next state.
  await page.waitForTimeout(10_500);
}

async function createScenario(
  suffix: string,
  options: {
    initialRunCount?: number;
  } = {}
): Promise<Scenario> {
  let scenario!: Scenario;

  await setDB(async (prisma) => {
    const email = `runs-refresh-${suffix}@test.com`;
    const initialRunCount = options.initialRunCount ?? 24;

    const user = await prisma.user.create({
      data: {
        email,
        name: "Runs Refresh User",
        admin: true,
        authenticationMethod: "MAGIC_LINK",
        confirmedBasicDetails: true,
      },
    });

    const personalAccessToken = await createPersonalAccessToken({
      name: `runs-refresh-${suffix}`,
      userId: user.id,
    });

    const organization = await createOrganization({
      title: `Runs Refresh Org ${suffix}`,
      userId: user.id,
      companySize: null,
    });

    const project = await createProject({
      organizationSlug: organization.slug,
      name: `Runs Refresh Project ${suffix}`,
      userId: user.id,
      version: "v3",
    });

    const environment = await prisma.runtimeEnvironment.findFirstOrThrow({
      where: {
        projectId: project.id,
        type: RuntimeEnvironmentType.PRODUCTION,
      },
    });

    const baseTime = new Date("2026-03-24T11:00:00.000Z").getTime();

    const initialRuns = Array.from({ length: initialRunCount }, (_, index) => {
      const runNumber = index + 1;
      const createdAt = new Date(baseTime + runNumber * 1_000);

      return {
        id: `run-base-${suffix}-${String(runNumber).padStart(2, "0")}`,
        friendlyId: `run_base_${suffix}_${String(runNumber).padStart(2, "0")}`,
        taskIdentifier: `seed-base-${runNumber}`,
        payload: JSON.stringify({ runNumber }),
        traceId: `trace-base-${suffix}-${runNumber}`,
        spanId: `span-base-${suffix}-${runNumber}`,
        queue: "seed-runs-refresh",
        runtimeEnvironmentId: environment.id,
        projectId: project.id,
        organizationId: organization.id,
        environmentType: RuntimeEnvironmentType.PRODUCTION,
        engine: RunEngineVersion.V2,
        status: TaskRunStatus.COMPLETED_SUCCESSFULLY,
        createdAt,
        updatedAt: createdAt,
        startedAt: createdAt,
        completedAt: new Date(createdAt.getTime() + 2_000),
        isTest: false,
      };
    });

    await prisma.taskRun.createMany({
      data: initialRuns,
    });

    scenario = {
      organization: { slug: organization.slug },
      project: { slug: project.slug },
      environment: { id: environment.id, slug: environment.slug },
      user: { email },
      personalAccessTokenId: personalAccessToken.id,
      adminToken: personalAccessToken.token,
      initialRunIds: initialRuns.map((run) => run.id),
      runsPath: `/orgs/${organization.slug}/projects/${project.slug}/env/${environment.slug}/runs`,
    };
  });

  return scenario;
}

async function insertNewRuns(scenario: Scenario, count: number) {
  let runIds: string[] = [];

  await setDB(async (prisma) => {
    const latestRun = await prisma.taskRun.findFirstOrThrow({
      where: {
        runtimeEnvironmentId: scenario.environment.id,
      },
      orderBy: [
        {
          createdAt: "desc",
        },
        {
          id: "desc",
        },
      ],
    });

    const existingNewRunCount = await prisma.taskRun.count({
      where: {
        runtimeEnvironmentId: scenario.environment.id,
        taskIdentifier: {
          startsWith: "seed-new-",
        },
      },
    });

    const newRuns = Array.from({ length: count }, (_, index) => {
      const runNumber = existingNewRunCount + index + 1;
      const createdAt = new Date(latestRun.createdAt.getTime() + runNumber * 1_000);

      return {
        id: `zz-run-new-${scenario.project.slug}-${runNumber}`,
        friendlyId: `run_new_${scenario.project.slug}_${runNumber}`,
        taskIdentifier: `seed-new-${runNumber}`,
        payload: JSON.stringify({ runNumber }),
        traceId: `trace-new-${scenario.project.slug}-${runNumber}`,
        spanId: `span-new-${scenario.project.slug}-${runNumber}`,
        queue: "seed-runs-refresh",
        runtimeEnvironmentId: scenario.environment.id,
        projectId: latestRun.projectId,
        organizationId: latestRun.organizationId,
        environmentType: RuntimeEnvironmentType.PRODUCTION,
        engine: RunEngineVersion.V2,
        status: TaskRunStatus.COMPLETED_SUCCESSFULLY,
        createdAt,
        updatedAt: createdAt,
        startedAt: createdAt,
        completedAt: new Date(createdAt.getTime() + 2_000),
        isTest: false,
      };
    });

    await prisma.taskRun.createMany({
      data: newRuns,
      skipDuplicates: true,
    });

    runIds = newRuns.map((run) => run.id);
  });

  return runIds;
}

async function cleanupScenario(scenario: Scenario) {
  await setDB(async (prisma) => {
    await prisma.personalAccessToken.deleteMany({
      where: {
        id: scenario.personalAccessTokenId,
      },
    });

    await prisma.organization.deleteMany({
      where: {
        slug: scenario.organization.slug,
      },
    });

    await prisma.user.deleteMany({
      where: {
        email: scenario.user.email,
      },
    });
  });
}

async function backfillRuns(request: APIRequestContext, adminToken: string, runIds: string[]) {
  const response = await request.post("/admin/api/v1/runs-replication/backfill", {
    headers: {
      Authorization: `Bearer ${adminToken}`,
    },
    data: {
      runIds,
    },
  });

  expect(response.ok()).toBe(true);
}
