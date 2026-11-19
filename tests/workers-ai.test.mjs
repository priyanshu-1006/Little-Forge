import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWorkersAiChat } from '../scripts/workers-ai-chat.mjs';

const url = 'https://api.cloudflare.com/client/v4/accounts/' + 'a'.repeat(32) + '/ai/v1/chat/completions';
const toolCalls = [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }];

test('Workers AI gets string content while the tool call, result ID and stream options stay intact', () => {
  const request = {
    model: '@cf/openai/gpt-oss-120b', stream: true,
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'Two ' }, { type: 'text', text: 'parts' }] },
      { role: 'assistant', content: null, reasoning_content: 'pass through', tool_calls: toolCalls },
      { role: 'tool', tool_call_id: 'call-1', content: 'result' },
      { role: 'assistant', tool_calls: toolCalls },
    ],
  };
  const signal = new AbortController().signal;
  const dispatcher = {};
  const init = { method: 'POST', body: JSON.stringify(request), headers: { Authorization: 'Bearer test-only', 'content-length': 200 }, signal, dispatcher };
  const normalized = normalizeWorkersAiChat(url, init);
  assert.deepEqual(JSON.parse(normalized.body), {
    ...request,
    messages: [
      { role: 'user', content: 'Two parts' },
      { ...request.messages[1], content: '' },
      request.messages[2],
      { ...request.messages[3], content: '' },
    ],
  });
  assert.equal(normalized.headers.get('authorization'), 'Bearer test-only');
  assert.equal(normalized.headers.has('content-length'), false);
  assert.equal(normalized.signal, signal);
  assert.equal(normalized.dispatcher, dispatcher);
});

test('normalization leaves other providers, non-chat requests and multimodal arrays untouched', () => {
  const init = { method: 'POST', body: JSON.stringify({ model: '@cf/openai/gpt-oss-120b', messages: [{ role: 'assistant', content: null, tool_calls: toolCalls }] }) };
  assert.equal(normalizeWorkersAiChat(url.replace('api.cloudflare.com', 'openrouter.ai'), init), init);
  assert.equal(normalizeWorkersAiChat(url.replace('chat/completions', 'responses'), init), init);
  assert.equal(normalizeWorkersAiChat(url + '?unrelated=true', init), init);
  const image = { method: 'POST', body: JSON.stringify({ model: '@cf/test', messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://example.com/image' } }] }] }) };
  assert.equal(normalizeWorkersAiChat(url, image), image);
});
