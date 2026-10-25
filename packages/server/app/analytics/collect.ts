import type { AnalyticsEngineDataset } from "@cloudflare/workers-types";
import { IDevice, UAParser } from "ua-parser-js";
import { maskBrowserVersion } from "~/lib/utils";

// Cookieless visitor/session tracking
// Uses the approach described here: https://notes.normally.com/cookieless-unique-visitor-counts/

function getMidnightDate(): Date {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return midnight;
}

function getNextLastModifiedDate(current: Date | null): Date {
    // in case date is an 'Invalid Date'
    if (current && isNaN(current.getTime())) {
        current = null;
    }

    const midnight = getMidnightDate();

    // check if new day, if it is then set to midnight
    let next = current ? current : midnight;
    next = midnight.getTime() - next.getTime() > 0 ? midnight : next;

    // Next seconds value is the current seconds value + 1, capped at 3
    const currentSeconds = next.getSeconds();
    next.setSeconds(Math.min(3, currentSeconds + 1));

    return next;
}

/**
 * Calculate bounce value based on hit count
 * @param hits The number of hits (1-3)
 * @returns Bounce value: 1 (bounce), -1 (anti-bounce), or 0 (normal)
 */
function getBounceValue(hits: number): number {
    if (hits === 1) {
        return 1; // First hit = bounce
    } else if (hits === 2) {
        return -1; // Second hit = anti-bounce
    } else {
        return 0; // Third+ hit = normal
    }
}

/**
 * Checks if the request indicates a new visitor based on the If-Modified-Since header.
 * Mimics browser caching behavior for cookieless tracking.
 * @param ifModifiedSince The value of the If-Modified-Since header.
 * @returns Object containing `newVisitor` boolean.
 */
function checkVisitorSession(ifModifiedSince: string | null): {
    newVisitor: boolean;
} {
    let newVisitor = true;

    if (ifModifiedSince) {
        // check today is a new day vs ifModifiedSince
        const today = new Date();
        const ifModifiedSinceDate = new Date(ifModifiedSince);
        if (
            today.getFullYear() === ifModifiedSinceDate.getFullYear() &&
            today.getMonth() === ifModifiedSinceDate.getMonth() &&
            today.getDate() === ifModifiedSinceDate.getDate()
        ) {
            // if ifModifiedSince is today, this is not a new visitor
            newVisitor = false;
        }
    }

    return { newVisitor };
}

/**
 * Handles cache-related headers (If-Modified-Since, Last-Modified) to determine
 * visitor status based on hit count for cookieless tracking.
 *
 * @param ifModifiedSince The value of the If-Modified-Since header from the request.
 * @returns An object containing:
 *  - `hits`: Number indicating the count of hits within the current session.
 *  - `nextLastModifiedDate`: The Date object to be set in the Last-Modified response header.
 */
export function handleCacheHeaders(ifModifiedSince: string | null): {
    hits: number;
    nextLastModifiedDate: Date;
} {
    const { newVisitor } = checkVisitorSession(ifModifiedSince);
    const nextLastModifiedDate = getNextLastModifiedDate(
        ifModifiedSince ? new Date(ifModifiedSince) : null,
    );

    // Calculate hits from the seconds component of the date
    // If it's a new day or first visit, hits will be 1
    // Otherwise, it's based on the seconds value, but capped at 3
    // 1 - first visit
    // 2 - anti bounce
    // 3 - regular page view (3+ hits)
    let hits = newVisitor ? 1 : nextLastModifiedDate.getSeconds();

    // Cap the hit count at 3 to avoid exposing exact hit counts publicly
    if (hits > 3) {
        hits = 3;
    }

    return {
        hits,
        nextLastModifiedDate,
    };
}

function extractParamsFromQueryString(requestUrl: string): {
    [key: string]: string;
} {
    const url = new URL(requestUrl);
    const queryString = url.search.slice(1).split("&");

    const params: { [key: string]: string } = {};

    queryString.forEach((item) => {
        const kv = item.split("=");
        if (kv[0]) params[kv[0]] = decodeURIComponent(kv[1]);
    });
    return params;
}

type EventFields = Pick<
    DataPoint,
    "eventName" | "eventCategory" | "eventLabel" | "eventData"
>;

// NOTE: event values are later interpolated into (unparameterized) Analytics Engine
//       SQL queries, so names are restricted to a safe charset and labels may not
//       contain quotes, backslashes or control characters.
export const EVENT_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
// eslint-disable-next-line no-control-regex
const EVENT_LABEL_PATTERN = /^[^'"\\\x00-\x1f]{1,256}$/;
const MAX_EVENT_DATA_LENGTH = 1024;

export function parseEventParams(params: {
    [key: string]: string;
}): EventFields | { error: string } {
    const { en, ec, el, ed } = params;

    if (!EVENT_NAME_PATTERN.test(en)) {
        return { error: "Invalid event name" };
    }
    if (ec && !EVENT_NAME_PATTERN.test(ec)) {
        return { error: "Invalid event category" };
    }
    if (el && !EVENT_LABEL_PATTERN.test(el)) {
        return { error: "Invalid event label" };
    }
    if (ed) {
        if (ed.length > MAX_EVENT_DATA_LENGTH) {
            return { error: "Event data too large" };
        }
        try {
            JSON.parse(ed);
        } catch {
            return { error: "Invalid event data" };
        }
    }

    return {
        eventName: en,
        eventCategory: ec,
        eventLabel: el,
        eventData: ed,
    };
}

function getDeviceTypeFromDevice(device: IDevice): string {
    // see: https://github.com/faisalman/ua-parser-js/issues/182
    return device.type === undefined ? "desktop" : device.type;
}

export function collectRequestHandler(
    request: Request,
    env: Env,
    extra: Record<string, string> = {}, // extra request properties (i.e. Cloudflare properties)
) {
    const params = extractParamsFromQueryString(request.url);

    const siteId = params.sid;
    if (!siteId || siteId === "") {
        return new Response("Missing siteId", { status: 400 });
    }

    const userAgent = request.headers.get("user-agent") || undefined;

    const parsedUserAgent = new UAParser(userAgent);

    // Custom events are recorded separately from pageviews: they never count as a
    // visit or (anti-)bounce, and must not advance the cookieless hit counter
    const isEvent = params.en !== undefined;
    let event: EventFields = {};
    if (isEvent) {
        const result = parseEventParams(params);
        if ("error" in result) {
            return new Response(result.error, { status: 400 });
        }
        event = result;
    }

    // Check if hit type parameter is provided in the request
    // If it is, use it to derive visit and bounce values; otherwise, calculate them using the If-Modified-Since header
    let isVisit = false;
    let bounceValue = 0;
    let nextLastModifiedDate: Date | undefined;
    let hits = 0;

    // Get hit count from params or cache headers
    if (isEvent) {
        hits = 0;
        nextLastModifiedDate = undefined;
    } else if (params.ht !== undefined) {
        // From params
        hits = parseInt(params.ht, 10);
        if (isNaN(hits) || hits <= 0) hits = 1;
        if (hits > 3) hits = 3;

        // Don't set nextLastModifiedDate when ht is provided
        nextLastModifiedDate = undefined;
    } else {
        // From cache headers
        const ifModifiedSince = request.headers.get("if-modified-since");
        const cacheResult = handleCacheHeaders(ifModifiedSince);
        hits = cacheResult.hits;
        nextLastModifiedDate = cacheResult.nextLastModifiedDate;
    }

    isVisit = hits === 1; // if first hit, it is a visit

    // Get bounce value based on hit count
    bounceValue = isEvent ? 0 : getBounceValue(hits);

    const browserVersion = maskBrowserVersion(
        parsedUserAgent.getBrowser().version,
    );

    const data: DataPoint = {
        siteId,
        host: params.h,
        path: params.p,
        referrer: params.r,
        newVisitor: isVisit ? 1 : 0,
        newSession: 0, // dead column
        bounce: bounceValue,
        // user agent stuff
        userAgent: userAgent,
        browserName: parsedUserAgent.getBrowser().name,
        browserVersion: browserVersion,
        deviceModel: parsedUserAgent.getDevice().model,
        deviceType: getDeviceTypeFromDevice(parsedUserAgent.getDevice()),
        // UTM parameters
        utmSource: params.us,
        utmMedium: params.um,
        utmCampaign: params.uc,
        utmTerm: params.ut,
        utmContent: params.uco,
        // custom event fields (empty for pageviews)
        ...event,
    };

    // NOTE: location is derived from Cloudflare-specific request properties
    // see: https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties
    const country = extra?.country;
    if (typeof country === "string") {
        data.country = country;
    }

    writeDataPoint(env.WEB_COUNTER_AE, data);

    // encode 1x1 transparent gif
    const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const gifData = atob(gif);
    const gifLength = gifData.length;
    const arrayBuffer = new ArrayBuffer(gifLength);
    const uintArray = new Uint8Array(arrayBuffer);
    for (let i = 0; i < gifLength; i++) {
        uintArray[i] = gifData.charCodeAt(i);
    }

    const headers: HeadersInit = {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "image/gif",
        Expires: "Mon, 01 Jan 1990 00:00:00 GMT",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Tk: "N", // not tracking
    };

    if (nextLastModifiedDate) {
        headers["Last-Modified"] = nextLastModifiedDate.toUTCString();
    }

    return new Response(arrayBuffer, {
        headers,
        status: 200,
    });
}

interface DataPoint {
    // index
    siteId?: string;

    // blobs
    host?: string | undefined;
    userAgent?: string;
    path?: string;
    country?: string;
    referrer?: string;
    browserName?: string;
    browserVersion?: string;
    deviceModel?: string;
    deviceType?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
    utmTerm?: string;
    utmContent?: string;
    eventName?: string;
    eventCategory?: string;
    eventLabel?: string;
    eventData?: string;

    // doubles
    newVisitor: number;
    newSession: number;
    bounce: number;
}

// NOTE: Cloudflare Analytics Engine has limits on total number of bytes, number of fields, etc.
// More here: https://developers.cloudflare.com/analytics/analytics-engine/get-started/#limits

export function writeDataPoint(
    analyticsEngine: AnalyticsEngineDataset,
    data: DataPoint,
) {
    const datapoint = {
        indexes: [data.siteId || ""], // Supply one index
        blobs: [
            data.host || "", // blob1
            data.userAgent || "", // blob2
            data.path || "", // blob3
            data.country || "", // blob4
            data.referrer || "", // blob5
            data.browserName || "", // blob6
            data.deviceModel || "", // blob7
            data.siteId || "", // blob8
            data.browserVersion || "", // blob9
            data.deviceType || "", // blob10
            data.utmSource || "", // blob11
            data.utmMedium || "", // blob12
            data.utmCampaign || "", // blob13
            data.utmTerm || "", // blob14
            data.utmContent || "", // blob15
            data.eventName || "", // blob16
            data.eventCategory || "", // blob17
            data.eventLabel || "", // blob18
            data.eventData || "", // blob19
        ],
        doubles: [data.newVisitor || 0, data.newSession || 0, data.bounce],
    };

    if (!analyticsEngine) {
        // no-op
        console.log("Can't save datapoint: Analytics unavailable");
        console.dir(datapoint, { depth: null });
        return;
    }

    analyticsEngine.writeDataPoint(datapoint);
}
