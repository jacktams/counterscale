import { useMemo, useState } from "react";
import { useFetcher } from "react-router";

import type { LoaderFunctionArgs } from "react-router";

import { getFiltersFromSearchParams, paramsFromUrl } from "~/lib/utils";
import PaginatedTableCard from "~/components/PaginatedTableCard";
import { SearchFilters } from "~/lib/types";
import { EVENT_NAME_PATTERN } from "~/analytics/collect";

export async function loader({ context, request }: LoaderFunctionArgs) {
    const { analyticsEngine } = context;

    const { interval, site, page = 1 } = paramsFromUrl(request.url);
    const url = new URL(request.url);
    const tz = url.searchParams.get("timezone") || "UTC";
    const filters = getFiltersFromSearchParams(url.searchParams);

    // when an event is selected, drill down into its most popular items (labels)
    const event = url.searchParams.get("event") || "";
    if (event && !EVENT_NAME_PATTERN.test(event)) {
        throw new Response("Invalid event name", { status: 400 });
    }

    return {
        countsByProperty: await analyticsEngine.getEventCountsByColumn(
            site,
            event ? "eventLabel" : "eventName",
            interval,
            tz,
            filters,
            event || undefined,
            Number(page),
        ),
        page: Number(page),
    };
}

export const EventsCard = ({
    siteId,
    interval,
    filters,
    timezone,
}: {
    siteId: string;
    interval: string;
    filters: SearchFilters;
    timezone: string;
}) => {
    const [selectedEvent, setSelectedEvent] = useState<string | null>(null);
    const extraParams = useMemo(
        () => (selectedEvent ? { event: selectedEvent } : undefined),
        [selectedEvent],
    );

    return (
        <div>
            {selectedEvent ? (
                <button
                    onClick={() => setSelectedEvent(null)}
                    className="text-sm text-muted-foreground hover:underline mb-2"
                >
                    ← All events
                </button>
            ) : null}
            <PaginatedTableCard
                // remount on drill-down so pagination resets
                key={selectedEvent ?? ""}
                siteId={siteId}
                interval={interval}
                columnHeaders={
                    selectedEvent
                        ? [selectedEvent, "Count"]
                        : ["Event", "Count"]
                }
                dataFetcher={useFetcher<typeof loader>()}
                loaderUrl="/resources/events"
                filters={filters}
                extraParams={extraParams}
                onClick={
                    selectedEvent
                        ? undefined
                        : (eventName) => setSelectedEvent(eventName)
                }
                timezone={timezone}
            />
        </div>
    );
};
