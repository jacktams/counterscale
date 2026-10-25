import { test, expect, type Request } from "@playwright/test";

const PAGE_URL = "http://localhost:3004/05_customEvents/";

function eventRequest(name: string) {
    return (request: Request) =>
        request.url().includes("/collect") &&
        new URL(request.url()).searchParams.get("en") === name;
}

test("replays events queued before the tracker loaded", async ({ page }) => {
    const requestPromise = page.waitForRequest(eventRequest("queued_event"));

    await page.goto(PAGE_URL);

    const params = new URL((await requestPromise).url()).searchParams;
    expect(params.get("sid")).toBe("events-test-site-id");
    expect(params.get("p")).toBe("/05_customEvents/");
    expect(params.get("el")).toBe("early");
    // events never carry hit type, so they can't affect visitor/bounce counts
    expect(params.has("ht")).toBe(false);
});

test("tracks clicks on data-counterscale-event elements", async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForFunction(() => Boolean(window.counterscale?.trackEvent));

    const requestPromise = page.waitForRequest(eventRequest("outbound_click"));
    await page.click("#outbound");

    const params = new URL((await requestPromise).url()).searchParams;
    expect(params.get("el")).toBe("github");
});

test("tracks image views once they scroll into view", async ({ page }) => {
    let viewRequests = 0;
    page.on("request", (request) => {
        if (eventRequest("image_view")(request)) viewRequests++;
    });

    await page.goto(PAGE_URL);
    await page.waitForFunction(() => Boolean(window.counterscale?.trackEvent));

    // not yet visible
    await page.waitForTimeout(300);
    expect(viewRequests).toBe(0);

    const requestPromise = page.waitForRequest(eventRequest("image_view"));
    await page.locator("#photo").scrollIntoViewIfNeeded();

    const params = new URL((await requestPromise).url()).searchParams;
    expect(params.get("el")).toBe("/05_customEvents/sunset.jpg");
    expect(params.get("ec")).toBe("gallery");

    // scrolling away and back doesn't fire again
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("#photo").scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    expect(viewRequests).toBe(1);
});

test("window.counterscale.trackEvent sends custom data", async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForFunction(() => Boolean(window.counterscale?.trackEvent));

    const requestPromise = page.waitForRequest(eventRequest("lightbox_open"));
    await page.evaluate(() =>
        window.counterscale.trackEvent({
            name: "lightbox_open",
            label: "sunset",
            data: { album: "iceland" },
        }),
    );

    const params = new URL((await requestPromise).url()).searchParams;
    expect(params.get("el")).toBe("sunset");
    expect(JSON.parse(params.get("ed")!)).toEqual({ album: "iceland" });
});
