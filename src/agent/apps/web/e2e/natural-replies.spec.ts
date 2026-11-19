import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

const viewports = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "mobile-390x844", width: 390, height: 844 },
];

test("natural replies show notes, one steps line, the task list, folded Mico messages and the plan card", async ({ page }, testInfo) => {
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto("/e2e/fixtures/natural-replies.html");
    const transcript = page.getByTestId("transcript");
    // Repeated and empty notes stay out; the answer is one bubble after one steps line.
    await expect(transcript.getByTestId("message-progress-note")).toHaveText([
      "Checking the failing deploy job first.",
      "The image build fails, not the registry.",
    ]);
    await expect(transcript.getByTestId("tool-activity-line")).toHaveCount(1);
    await expect(transcript.getByTestId("message-bot-bubble").first()).toHaveText(
      "The web image build fails on this commit. I need your OK to rerun it on the fixed commit.",
    );
    await expect(transcript.getByTestId("plan")).toContainText("2 of 3 tasks done");
    // Three Mico-to-Mico messages fold into one row that opens on request.
    const exchange = transcript.getByTestId("peer-exchange").getByRole("button");
    await expect(exchange).toHaveText("3 messages with DevOps, Developer, and Marketing");
    await expect(transcript.getByTestId("peer-receipt-chip")).toHaveCount(0);
    await expect(transcript.getByTestId("plan-card")).toContainText("Rerun the image build");
    await expect(transcript.getByTestId("plan-card").getByRole("button", { name: /^Start/ })).toBeVisible();
    await expect(page.locator("body")).toHaveJSProperty("scrollWidth", viewport.width);
    await captureScreenshot(page, testInfo, `natural-replies-${viewport.name}`);
    await exchange.click();
    await expect(transcript.getByTestId("peer-receipt-chip")).toHaveCount(3);
  }
});
