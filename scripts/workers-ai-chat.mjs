const workersEndpoint = /^\/client\/v4\/accounts\/[a-f0-9]{32}\/ai\/v1\/chat\/completions$/i;

export function normalizeWorkersAiChat(input, init) {
  if ((typeof input !== 'string' && !(input instanceof URL)) || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string') return init;
  const url = new URL(input);
  if (url.origin !== 'https://api.cloudflare.com' || url.username || url.password || url.search || url.hash || !workersEndpoint.test(url.pathname)) return init;

  let request;
  try { request = JSON.parse(init.body); } catch { return init; }
  if (!Array.isArray(request?.messages) || typeof request.model !== 'string' || !request.model.startsWith('@cf/')) return init;

  let changed = false;
  const messages = request.messages.map(message => {
    if (message?.role === 'assistant' && message.content == null && Array.isArray(message.tool_calls) && message.tool_calls.length) {
      changed = true;
      return { ...message, content: '' };
    }
    if (Array.isArray(message?.content) && message.content.length &&
      message.content.every(part => part?.type === 'text' && typeof part.text === 'string')) {
      changed = true;
      return { ...message, content: message.content.map(part => part.text).join('') };
    }
    return message;
  });
  if (!changed) return init;
  const body = JSON.stringify({ ...request, messages });
  const headers = new Headers(init.headers);
  headers.delete('content-length');
  return { ...init, headers, body };
}
