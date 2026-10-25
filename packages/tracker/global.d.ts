// Use a simpler approach with a comment to explain the type
declare global {
    interface Window {
        counterscale: {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            // Command queue: an array before the loader runs, then replaced by an
            // object whose push() executes commands immediately
            q?: any[] | { push: (...cmds: any[]) => number };
            init: (opts: any) => void;
            trackPageview: (opts?: any) => Promise<void>;
            trackEvent: (opts: {
                name: string;
                category?: string;
                label?: string;
                data?: Record<string, unknown>;
            }) => void;
            cleanup: () => void;
        };
    }
}

export {};
