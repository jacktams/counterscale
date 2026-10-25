import type {
    CollectRequestParams,
    EventParams,
    TrackEventOpts,
    UtmParams,
} from "./types";
import { queryParamStringify } from "./utils";

export function buildCollectRequestParams(
    siteId: string,
    hostname: string,
    path: string,
    referrer: string,
    utmParams: UtmParams = {},
    hitType?: string,
): CollectRequestParams {
    const params: CollectRequestParams = {
        p: path,
        h: hostname,
        r: referrer,
        sid: siteId,
    };

    if (hitType) {
        params.ht = hitType;
    }

    Object.assign(params, utmParams);

    return params;
}

/**
 * Builds params for a custom event. Events deliberately omit referrer, UTM and
 * hit type params so they never affect visitor/bounce counts.
 */
export function buildEventRequestParams(
    siteId: string,
    hostname: string,
    path: string,
    event: TrackEventOpts,
): CollectRequestParams & EventParams {
    const params: CollectRequestParams & EventParams = {
        p: path,
        h: hostname,
        r: "",
        sid: siteId,
        en: event.name,
    };

    if (event.category) params.ec = event.category;
    if (event.label) params.el = event.label;
    if (event.data) params.ed = JSON.stringify(event.data);

    return params;
}

export function buildCollectUrl(
    baseUrl: string,
    params: CollectRequestParams,
    filterEmpty = false,
): string {
    return baseUrl + queryParamStringify(params, filterEmpty);
}
