import { autoTrackPageviews, trackEvent } from "./track";
import { autoTrackEvents } from "./autoEvents";
import type { BaseClientConfig } from "../shared/types";

export type ClientOpts = BaseClientConfig & {
    autoTrackPageviews?: boolean;
    // track clicks/views declared via data-counterscale-* attributes
    autoTrackEvents?: boolean;
};

export class Client {
    siteId: string;
    reporterUrl: string;
    reportOnLocalhost = false;

    _cleanupAutoTrackPageviews?: () => void;
    _cleanupAutoTrackEvents?: () => void;

    constructor(opts: ClientOpts) {
        this.siteId = opts.siteId;
        this.reporterUrl = opts.reporterUrl;

        if (opts.reportOnLocalhost) {
            this.reportOnLocalhost = opts.reportOnLocalhost;
        }

        // default to true
        if (opts.autoTrackPageviews === undefined || opts.autoTrackPageviews) {
            // Use setTimeout to ensure this runs after the constructor
            // This helps with testing and avoids issues with async trackPageview
            setTimeout(() => {
                this._cleanupAutoTrackPageviews = autoTrackPageviews(this);
            }, 0);
        }

        if (opts.autoTrackEvents) {
            this._cleanupAutoTrackEvents = autoTrackEvents((event) =>
                trackEvent(this, event),
            );
        }
    }

    cleanup() {
        if (this._cleanupAutoTrackPageviews) {
            this._cleanupAutoTrackPageviews();
        }
        if (this._cleanupAutoTrackEvents) {
            this._cleanupAutoTrackEvents();
        }
    }
}
