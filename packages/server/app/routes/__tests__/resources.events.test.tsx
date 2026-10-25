// @vitest-environment jsdom
import {
    vi,
    test,
    describe,
    beforeEach,
    afterEach,
    expect,
    Mock,
} from "vitest";
import "vitest-dom/extend-expect";

import { loader } from "../resources.events";
import { createFetchResponse, getDefaultContext } from "./testutils";

describe("Resources/Events route", () => {
    let fetch: Mock;

    beforeEach(() => {
        fetch = global.fetch = vi.fn();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("loader", () => {
        test("returns counts grouped by event name", async () => {
            fetch.mockResolvedValueOnce(
                createFetchResponse({
                    data: [
                        { blob16: "image_view", count: "50" },
                        { blob16: "outbound_click", count: "5" },
                    ],
                }),
            );

            const response = await loader({
                ...getDefaultContext(),
                // @ts-expect-error we don't need to provide all the properties of the request object
                request: {
                    url: "http://localhost:3000/resources/events?site=example.com&interval=7d",
                },
            });

            expect(response).toEqual({
                countsByProperty: [
                    ["image_view", 50],
                    ["outbound_click", 5],
                ],
                page: 1,
            });
            expect(fetch.mock.calls[0][1].body).toContain("GROUP BY blob16");
        });

        test("returns most popular items when an event is selected", async () => {
            fetch.mockResolvedValueOnce(
                createFetchResponse({
                    data: [{ blob18: "/photos/a.jpg", count: "7" }],
                }),
            );

            const response = await loader({
                ...getDefaultContext(),
                // @ts-expect-error we don't need to provide all the properties of the request object
                request: {
                    url: "http://localhost:3000/resources/events?site=example.com&interval=7d&event=image_view",
                },
            });

            expect(response).toEqual({
                countsByProperty: [["/photos/a.jpg", 7]],
                page: 1,
            });
            const body = fetch.mock.calls[0][1].body;
            expect(body).toContain("GROUP BY blob18");
            expect(body).toContain("AND blob16 = 'image_view'");
        });

        test("rejects invalid event names", async () => {
            await expect(
                loader({
                    ...getDefaultContext(),
                    // @ts-expect-error we don't need to provide all the properties of the request object
                    request: {
                        url: "http://localhost:3000/resources/events?site=example.com&interval=7d&event=x'%20OR%201=1",
                    },
                }),
            ).rejects.toMatchObject({ status: 400 });
            expect(fetch).not.toHaveBeenCalled();
        });
    });
});
