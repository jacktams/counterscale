import { afterEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    init: vi.fn(),
    trackEvent: vi.fn(),
}));

vi.mock("../index", () => ({
    init: mocks.init,
    trackEvent: mocks.trackEvent,
    trackPageview: vi.fn(),
    cleanup: vi.fn(),
}));

describe("tracker loader", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        mocks.init.mockReset();
        mocks.trackEvent.mockReset();
        // @ts-expect-error resetting global between tests
        delete window.counterscale;
        vi.resetModules();
    });

    test.each([
        {
            name: "default filename",
            scriptUrl: "https://example.com/tracker.js",
            reporterUrl: "https://example.com/collect",
        },
        {
            name: "custom filename",
            scriptUrl: "https://example.com/analytics.js",
            reporterUrl: "https://example.com/collect",
        },
        {
            name: "deployment subpath",
            scriptUrl: "https://example.com/apps/counterscale/custom.js",
            reporterUrl: "https://example.com/apps/counterscale/collect",
        },
        {
            name: "query and hash components",
            scriptUrl:
                "https://example.com/apps/counterscale/custom.js?v=123#loader",
            reporterUrl: "https://example.com/apps/counterscale/collect",
        },
    ])(
        "derives the collect endpoint for $name",
        async ({ scriptUrl, reporterUrl }) => {
            document.body.innerHTML = `<script id="counterscale-script" data-site-id="test-site" src="${scriptUrl}"></script>`;

            await import("../tracker");

            expect(mocks.init).toHaveBeenCalledOnce();
            expect(mocks.init).toHaveBeenCalledWith({
                siteId: "test-site",
                reportOnLocalhost: false,
                reporterUrl,
                autoTrackPageviews: true,
                autoTrackEvents: true,
            });
        },
    );

    test("exposes trackEvent on window.counterscale", async () => {
        document.body.innerHTML = `<script id="counterscale-script" data-site-id="test-site" src="https://example.com/tracker.js"></script>`;

        await import("../tracker");

        window.counterscale.trackEvent({ name: "image_view", label: "a" });
        expect(mocks.trackEvent).toHaveBeenCalledWith({
            name: "image_view",
            label: "a",
        });
    });

    test("replays trackEvent commands queued before load, and runs later pushes", async () => {
        document.body.innerHTML = `<script id="counterscale-script" data-site-id="test-site" src="https://example.com/tracker.js"></script>`;
        // @ts-expect-error partial stub, as a site would define before the script loads
        window.counterscale = {
            q: [
                ["set", "siteId", "ignored"],
                ["trackEvent", { name: "early" }],
            ],
        };

        await import("../tracker");

        expect(mocks.trackEvent).toHaveBeenCalledWith({ name: "early" });

        window.counterscale.q!.push(["trackEvent", { name: "late" }]);
        expect(mocks.trackEvent).toHaveBeenCalledWith({ name: "late" });
        expect(mocks.trackEvent).toHaveBeenCalledTimes(2);
    });
});
