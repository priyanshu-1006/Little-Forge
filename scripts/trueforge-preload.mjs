import { createRequire } from 'node:module';
import { normalizeWorkersAiChat } from './workers-ai-chat.mjs';

// TrueForge's outbound guard calls its own Undici instance. Keep its dispatcher,
// redirect handling, retries, and stream intact while normalizing the request body.
const require = createRequire(import.meta.url);
const coreRequire = createRequire(require.resolve('@truefoundry/trueforge-core/core'));
const undici = coreRequire('undici');
const fetch = undici.fetch;
undici.fetch = (input, init) => fetch(input, normalizeWorkersAiChat(input, init));
