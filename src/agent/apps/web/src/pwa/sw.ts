import type { ServiceWorkerScope } from "./service-worker";
import { installServiceWorker } from "./service-worker";

import { installPushWorker } from "./push-worker";

declare const self: ServiceWorkerScope & ServiceWorkerGlobalScope;
// Replaced with the built shell and its versioned cache name by the PWA build plugin.
declare const __RAKAZO_SW_PRECACHE__: string[];
declare const __RAKAZO_SW_CACHE__: string;

installServiceWorker(self, __RAKAZO_SW_PRECACHE__, __RAKAZO_SW_CACHE__, installPushWorker(self));
