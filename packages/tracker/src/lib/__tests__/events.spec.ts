import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { trackEvent } from "../track";
import * as requestModule from "../request";
import { Client } from "../client";
import { autoTrackEvents } from "../autoEvents";
import { buildEventRequestParams } from "../../shared/request";

describe("buildEventRequestParams", () => {
    test("includes event fields and serializes data", () => {
        expect(
            buildEventRequestParams("site", "https://example.com", "/p", {
                name: "image_view",
                category: "gallery",
                label: "/img/a.jpg",
                data: { album: "iceland" },
            }),
        ).toEqual({
            sid: "site",
            h: "https://example.com",
            p: "/p",
            r: "",
            en: "image_view",
            ec: "gallery",
            el: "/img/a.jpg",
            ed: '{"album":"iceland"}',
        });
    });

    test("omits optional fields and hit type", () => {
        const params = buildEventRequestParams("site", "h", "/", {
            name: "click",
        });
        expect(params).not.toHaveProperty("ec");
        expect(params).not.toHaveProperty("el");
        expect(params).not.toHaveProperty("ed");
        expect(params).not.toHaveProperty("ht");
    });
});

describe("trackEvent", () => {
    const makeEventRequestMock = vi.fn();
    const checkCacheStatusMock = vi.fn();

    beforeEach(() => {
        vi.spyOn(requestModule, "makeEventRequest").mockImplementation(
            makeEventRequestMock,
        );
        vi.spyOn(requestModule, "checkCacheStatus").mockImplementation(
            checkCacheStatusMock,
        );
        makeEventRequestMock.mockReset();
        checkCacheStatusMock.mockReset();

        Object.defineProperty(window, "location", {
            writable: true,
            value: {
                pathname: "/gallery",
                search: "?utm_source=x",
                host: "example.com",
                hostname: "example.com",
            },
        });
        vi.spyOn(document, "querySelector").mockReturnValue(null);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function makeClient(opts: { reportOnLocalhost?: boolean } = {}) {
        return new Client({
            siteId: "test-site",
            reporterUrl: "https://counterscale.example.com/collect",
            autoTrackPageviews: false,
            ...opts,
        });
    }

    test("sends an event request without touching the hit counter", () => {
        trackEvent(makeClient(), { name: "image_view", label: "a" });

        expect(checkCacheStatusMock).not.toHaveBeenCalled();
        expect(makeEventRequestMock).toHaveBeenCalledWith(
            "https://counterscale.example.com/collect",
            expect.objectContaining({
                sid: "test-site",
                p: "/gallery",
                en: "image_view",
                el: "a",
            }),
        );
        // events don't carry UTM params
        expect(makeEventRequestMock.mock.calls[0][1]).not.toHaveProperty("us");
    });

    test("requires a name", () => {
        expect(() =>
            // @ts-expect-error testing invalid input
            trackEvent(makeClient(), {}),
        ).toThrow(/requires an event name/);
    });

    test("does not report on localhost unless enabled", () => {
        window.location.hostname = "localhost";
        trackEvent(makeClient(), { name: "x" });
        expect(makeEventRequestMock).not.toHaveBeenCalled();

        trackEvent(makeClient({ reportOnLocalhost: true }), { name: "x" });
        expect(makeEventRequestMock).toHaveBeenCalledOnce();
    });
});

describe("makeEventRequest", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    test("uses keepalive fetch so requests survive navigation", () => {
        const fetchMock = vi.fn().mockResolvedValue({});
        vi.stubGlobal("fetch", fetchMock);

        requestModule.makeEventRequest("https://c.example.com/collect", {
            sid: "s",
            h: "h",
            p: "/",
            r: "",
            en: "click",
        });

        expect(fetchMock).toHaveBeenCalledWith(
            "https://c.example.com/collect?sid=s&h=h&p=%2F&en=click",
            expect.objectContaining({ keepalive: true, mode: "no-cors" }),
        );
        vi.unstubAllGlobals();
    });
});

describe("autoTrackEvents", () => {
    type ObserverCallback = (
        entries: Partial<IntersectionObserverEntry>[],
    ) => void;
    let ioCallback: ObserverCallback;
    let observed: Element[];
    let cleanup: () => void;
    const track = vi.fn();

    beforeEach(() => {
        observed = [];
        track.mockReset();
        vi.stubGlobal(
            "IntersectionObserver",
            class {
                constructor(cb: ObserverCallback) {
                    ioCallback = cb;
                }
                observe(el: Element) {
                    observed.push(el);
                }
                unobserve(el: Element) {
                    observed = observed.filter((e) => e !== el);
                }
                disconnect() {
                    observed = [];
                }
            },
        );
    });

    afterEach(() => {
        cleanup?.();
        document.body.innerHTML = "";
        vi.unstubAllGlobals();
    });

    test("tracks clicks on elements (and their children) with data-counterscale-event", () => {
        document.body.innerHTML = `
            <a id="link" href="#" data-counterscale-event="outbound_click" data-counterscale-label="github" data-counterscale-category="links">
                <span id="inner">GitHub</span>
            </a>
            <button id="plain">nope</button>`;
        cleanup = autoTrackEvents(track);

        document.getElementById("inner")!.click();
        document.getElementById("plain")!.click();

        expect(track).toHaveBeenCalledOnce();
        expect(track).toHaveBeenCalledWith({
            name: "outbound_click",
            category: "links",
            label: "github",
        });
    });

    test("tracks views once per element, defaulting label to image src path", () => {
        document.body.innerHTML = `<img id="img" src="https://example.com/photos/sunset.jpg?w=200" data-counterscale-view="image_view">`;
        cleanup = autoTrackEvents(track);

        const img = document.getElementById("img")!;
        expect(observed).toContain(img);

        ioCallback([{ target: img, isIntersecting: true }]);
        ioCallback([{ target: img, isIntersecting: true }]);

        expect(track).toHaveBeenCalledOnce();
        expect(track).toHaveBeenCalledWith({
            name: "image_view",
            category: undefined,
            label: "/photos/sunset.jpg",
        });
    });

    test("ignores elements that are not intersecting", () => {
        document.body.innerHTML = `<div id="d" data-counterscale-view="seen" data-counterscale-label="x"></div>`;
        cleanup = autoTrackEvents(track);

        ioCallback([
            { target: document.getElementById("d")!, isIntersecting: false },
        ]);
        expect(track).not.toHaveBeenCalled();
    });

    test("observes elements added after load", async () => {
        cleanup = autoTrackEvents(track);

        const img = document.createElement("img");
        img.setAttribute("data-counterscale-view", "image_view");
        document.body.appendChild(img);

        // MutationObserver callbacks are delivered as microtasks
        await Promise.resolve();
        expect(observed).toContain(img);
    });

    test("cleanup removes the click listener", () => {
        document.body.innerHTML = `<a id="link" data-counterscale-event="click"></a>`;
        cleanup = autoTrackEvents(track);
        cleanup();

        document.getElementById("link")!.click();
        expect(track).not.toHaveBeenCalled();
    });
});
