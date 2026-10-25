export type ColumnMappingToType<
    T extends (typeof ColumnMappings)[keyof typeof ColumnMappings],
> = T extends `blob${number}`
    ? string
    : T extends `double${number}`
      ? number
      : never;

/**
 * This maps logical column names to the actual column names in the data store.
 */

export const ColumnMappings = {
    /**
     * blobs
     */
    host: "blob1",
    userAgent: "blob2",
    path: "blob3",
    country: "blob4",
    referrer: "blob5",
    browserName: "blob6",
    deviceModel: "blob7",
    siteId: "blob8",
    browserVersion: "blob9",
    deviceType: "blob10",
    utmSource: "blob11",
    utmMedium: "blob12",
    utmCampaign: "blob13",
    utmTerm: "blob14",
    utmContent: "blob15",

    // custom events: rows with an empty eventName are pageviews
    eventName: "blob16",
    eventCategory: "blob17",
    // groupable identifier for the thing interacted with (e.g. image id, slug)
    eventLabel: "blob18",
    // JSON string of arbitrary event data (stored, not queried)
    eventData: "blob19",

    /**
     * doubles
     */

    // this record is a new visitor (every 24h)
    newVisitor: "double1",

    // this record is a new session (resets after 30m inactivity)
    newSession: "double2",

    // this record is the bounce value
    bounce: "double3",
} as const;

/**
 * Column mappings that only apply to custom event rows; excluded from pageview rollups.
 */
export const EventColumns = [
    "eventName",
    "eventCategory",
    "eventLabel",
    "eventData",
] as const satisfies (keyof typeof ColumnMappings)[];
