// Optional AntSeed provider. Install the official SDK separately, as for the
// speech proof; importing this module never starts a seller or announces it.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sdkRoot = resolve(process.env.ANTSEED_PROOF_MODULES ?? 'runtime/antseed-proof/node_modules');
const { BaseProvider, StaticTokenProvider } = await import(pathToFileURL(resolve(sdkRoot, '@antseed/provider-core/dist/index.js')).href);

export const JEV_HTTP_TIMEOUT_MS = 555_000;

const plugin = {
  name: 'mycellios-decisions',
  displayName: 'Mycellios Kev decisions',
  version: '0.1.0',
  type: 'provider',
  description: 'jev: independent Kev-4B Q8 choice, boolean probability and score decisions. Not TypeSafe Jev weights or a text generator.',
  configSchema: [
    { key: 'MYCELLIOS_API_KEY', label: 'Mycellios API key', type: 'secret', required: true },
    { key: 'MYCELLIOS_BASE_URL', label: 'Mycellios API URL', type: 'string', required: false, default: 'https://www.mycellios.com' },
  ],
  createProvider(config) {
    const apiKey = config.MYCELLIOS_API_KEY?.trim();
    if (!apiKey) throw new Error('MYCELLIOS_API_KEY is required');
    const url = new URL(config.MYCELLIOS_BASE_URL ?? 'https://www.mycellios.com');
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
      || !(url.protocol === 'https:' && url.hostname === 'www.mycellios.com'
        || url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw new Error('jev_upstream_url_rejected');
    return new BaseProvider({
      name: 'mycellios-decisions', services: ['jev'],
      pricing: { defaults: { inputUsdPerMillion: 0, outputUsdPerMillion: 0, cachedInputUsdPerMillion: 0 } },
      serviceApiProtocols: { jev: ['openai-chat-completions'] },
      serviceCapabilities: { jev: { contextWindow: 256, inputs: ['text'], outputs: ['text'],
        reasoning: false, toolUse: false, structuredOutput: true } },
      relay: { baseUrl: url.origin, authHeaderName: 'authorization', authHeaderValue: `Bearer ${apiKey}`,
        tokenProvider: new StaticTokenProvider(apiKey), allowedServices: ['jev'], maxConcurrency: 1,
        timeoutMs: JEV_HTTP_TIMEOUT_MS, redirect: 'error' },
    });
  },
};

export default plugin;
