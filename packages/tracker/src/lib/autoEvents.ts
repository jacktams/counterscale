import type { TrackEventOpts } from "../shared/types";

// Declarative event tracking via data attributes:
//
//   <a href="..." data-counterscale-event="outbound_click" data-counterscale-label="github">
//   <img src="..." data-counterscale-view="image_view" data-counterscale-label="sunset">
//
// - data-counterscale-event: tracks a click with the given event name
// - data-counterscale-view: tracks the element scrolling into view (once per element per page load)
// - data-counterscale-label: item identifier (defaults to an image's src path, see getLabel)
// - data-counterscale-category: optional event category

const CLICK_ATTR = "data-counterscale-event";
const VIEW_ATTR = "data-counterscale-view";
const LABEL_ATTR = "data-counterscale-label";
const CATEGORY_ATTR = "data-counterscale-category";

const VIEW_THRESHOLD = 0.5;

// Cloudflare Image Resizing URLs: /cdn-cgi/image/<options>/<source path>
const CF_IMAGE_RESIZING_PREFIX = /^\/cdn-cgi\/image\/[^/]+(?=\/)/;

function getLabel(el: Element): string | undefined {
    const label = el.getAttribute(LABEL_ATTR);
    if (label) {
        return label;
    }

    // NOTE: uses the authored src (not currentSrc, which varies with the srcset
    //       candidate picked for the viewport) and strips resizing options, so the
    //       same image is always counted under one label
    if (el instanceof HTMLImageElement) {
        const src = el.getAttribute("src");
        if (src) {
            try {
                return new URL(src, document.baseURI).pathname.replace(
                    CF_IMAGE_RESIZING_PREFIX,
                    "",
                );
            } catch {
                return undefined;
            }
        }
    }
    return undefined;
}

function eventFromElement(el: Element, nameAttr: string): TrackEventOpts {
    return {
        name: el.getAttribute(nameAttr) || "",
        category: el.getAttribute(CATEGORY_ATTR) || undefined,
        label: getLabel(el),
    };
}

export function autoTrackEvents(track: (opts: TrackEventOpts) => void) {
    const onClick = (e: MouseEvent) => {
        const target = e.target as Element | null;
        const el = target?.closest?.(`[${CLICK_ATTR}]`);
        if (el) {
            track(eventFromElement(el, CLICK_ATTR));
        }
    };
    // capture phase so tracking happens even if a handler stops propagation
    document.addEventListener("click", onClick, true);

    let intersectionObserver: IntersectionObserver | undefined;
    let mutationObserver: MutationObserver | undefined;

    if (typeof IntersectionObserver !== "undefined") {
        const seen = new WeakSet<Element>();
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (!entry.isIntersecting || seen.has(entry.target)) {
                        return;
                    }
                    seen.add(entry.target);
                    observer.unobserve(entry.target);
                    track(eventFromElement(entry.target, VIEW_ATTR));
                });
            },
            { threshold: VIEW_THRESHOLD },
        );
        intersectionObserver = observer;

        const observeWithin = (root: ParentNode) => {
            if (root instanceof Element && root.hasAttribute(VIEW_ATTR)) {
                observer.observe(root);
            }
            root.querySelectorAll(`[${VIEW_ATTR}]`).forEach((el) => {
                if (!seen.has(el)) observer.observe(el);
            });
        };

        observeWithin(document);

        // pick up elements added later (e.g. lazy-loaded galleries, lightboxes)
        if (typeof MutationObserver !== "undefined") {
            mutationObserver = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (node instanceof Element) observeWithin(node);
                    });
                });
            });
            mutationObserver.observe(document.documentElement, {
                childList: true,
                subtree: true,
            });
        }
    }

    return () => {
        document.removeEventListener("click", onClick, true);
        intersectionObserver?.disconnect();
        mutationObserver?.disconnect();
    };
}
