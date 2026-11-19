# Free model setup for Little Forge

## Select a provider in Little Forge

Click the model button at the top of the panel, or run **Little Forge: Choose Provider and Model** from the VS Code Command Palette. Pick a provider to see its saved models. When connecting a preset, paste the API token into the masked VS Code prompt. TrueForge stores it in its local provider configuration. The picker lists saved models and does not spend model quota. Use **Refresh models** after changing a provider directly in TrueForge.

- **Workers AI** is the first option for Task B. Stay on Workers Free, and use **Workers AI → Use REST API** to create the separate API token. Little Forge can prefill the account ID when the provider draft already exists. The presets are GPT-OSS 120B, GPT-OSS 20B, and GLM-4.7 Flash. [Workers AI setup](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) · [Free allowance](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- **OpenRouter** includes Particle-1 and GPT-OSS 120B under their explicit `:free` model IDs. [Free model limits](https://openrouter.ai/collections/free-models)
- **Groq** includes GPT-OSS 120B, GPT-OSS 20B, and Qwen 3.8 27B. Its token-per-minute limit can interrupt a long agent run even if requests remain. [Groq rate limits](https://console.groq.com/docs/rate-limits)
- **Gemini** uses the existing native Google provider in TrueForge. **Custom** opens TrueForge settings for Ollama or other OpenAI-compatible endpoints. **Cohere** and **Vercel AI Gateway** have their own presets. Usage depends on the plan associated with the key.

For acceptance, select the model in Little Forge, open a clean Task B Flask checkout, and submit the [original Task B prompt](../evaluation/tasks.json) in **Build** mode. Use the [evaluation checklist](../evaluation/README.md#task-b-discover-three-meaningful-files) to verify the proposal, reviews, and tests.

If Workers AI returns HTTP 400 after a repository tool succeeds, start TrueForge via this repository’s `npm run harness` launcher. It sends empty assistant tool-call content as a string for Workers AI Chat Completions. When a recording setup already uses a custom `SQLITE_PATH`, keep that path on restart to retain its saved providers and sessions.

## Earlier Gemini setup and findings

Researched 30 October 2026. **Recommended starting point: Gemini 3.8 Flash on a Google AI Studio project with usable free-tier quota.** This recommendation is based on documented capabilities and limits; real model acceptance is still pending.

## Why this option

| Option | Fit for the Flask tasks | Free-tier constraint |
| --- | --- | --- |
| **Google Gemini 3.8 Flash** | Recommended first. Stable model with function calling, streaming and a large context window; present in the pinned TrueForge catalog. | Free input/output; exact quota must be checked in the user's AI Studio project. |
| **Groq GPT OSS 120B** | Alternative if Gemini is unavailable. Tool calling is supported. | Published free limits include 8,000 tokens/minute and 1,000 requests/day. Growing tool histories can exceed the token allowance. |
| **OpenRouter free variants** | Suitable for occasional experiments. An explicit model gives more repeatable evaluation than its random free router. | Without buying credits, 50 requests/day. A single agent task can use many requests. |

Sources: [Google pricing](https://ai.google.dev/gemini-api/docs/pricing), [Gemini model capabilities](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash), [Google project quotas](https://ai.google.dev/gemini-api/docs/rate-limits), [Groq limits](https://console.groq.com/docs/rate-limits), [Groq tool use](https://console.groq.com/docs/tool-use/overview), [OpenRouter free limits](https://openrouter.ai/collections/free-models), [OpenRouter free router](https://openrouter.ai/docs/guides/routing/routers/free-router).

This is a project-specific recommendation, not a benchmark result. Free access has quotas and availability limits. Google may use free-tier inputs and responses for product improvement, including human review; use the public Flask evaluation repository and exclude private code and credentials. See [Google's terms](https://ai.google.dev/gemini-api/terms).

## Complete the account step

1. Open [Google AI Studio API keys](https://aistudio.google.com/apikey), sign in, and create a key for a project on the **Free** tier. Keep billing disabled for this zero-spend setup. If the project only offers paid access or no usable quota, stop and use an alternative rather than enabling billing.
2. Open [local TrueForge settings](http://127.0.0.1:8790/settings). Choose **Models → google-gemini → Configure**. The dialog says **Configure Provider Details** and has an **API key** field.
3. Paste the key directly into that local field and click **Create**. Leave **Advanced · custom endpoint** unchanged. Do not put the key in chat, source files, examples, screenshots or receipts.
4. In Little Forge, choose **Connect**, then **google-gemini/gemini-3-8-flash**. The key remains in the local harness's ignored state; the extension receives the configured model name.
5. Check the project's active limits in AI Studio. Free quotas are per project, not per key. Generating extra keys does not increase them.

The native provider is intentional. TrueForge's Google adapter preserves the tool-call metadata needed for subsequent turns. Little Forge continues to call only TrueForge; no provider request code is added to the extension.

## Exact identifiers and local defaults

| Field | Value |
| --- | --- |
| TrueForge provider type | `google-gemini` |
| Model name passed to TrueForge | `google-gemini/gemini-3-8-flash` |
| Google's upstream model ID | `gemini-3.8-flash` |
| Native provider base URL | `https://generativelanguage.googleapis.com/v1beta` |
| Extension context capacity for the initial trial | `32768` |
| Extension per-response output reserve | `4096` |
| Paid fallback | None configured |

The provider catalog advertises the model's larger capacity; the extension deliberately uses a smaller working budget. The optional `littleForge.reasoningEffort` setting passes low/medium/high through TrueForge; empty preserves the provider default. Google's [thinking guide](https://ai.google.dev/gemini-api/docs/thinking) documents minimal as Flash-Lite's default and medium as Flash 3.8's default. Medium effort is a useful controlled comparison for multi-step coding; it is not a guarantee of a correct patch. Gemini 3.8 accepts low/medium/high, not `minimal`. The native base URL differs from Google's separate OpenAI-compatible endpoint. The headless runner accepts the same choice with `--reasoning medium`.

The credential-free template [gemini-free.example.json](../trueforge/gemini-free.example.json) shows the verified manifest shape. It is documentation, not an executed setup or a stored key. Prefer the local settings form; never replace its placeholder in a tracked file.

After the provider is saved, use the model picker or these rehearsal commands from `little-forge`:

```powershell
npm.cmd run spike
npm.cmd run accept:live -- --task A --model google-gemini/gemini-3-8-flash --context 32768
```

The first command lists configured models without reading keys. The second starts actual inference through TrueForge and pauses for explicit hunk decisions. It is production-core rehearsal; native VS Code selection, diff review and final recording remain separate acceptance steps. See [the evaluation guide](../evaluation/README.md).

## Quotas and errors

- **Empty model picker:** the provider was not saved in this harness instance. A healthy page or an open setup dialog does not mean a model is configured. `localhost:8790` and `127.0.0.1:8790` reach this same local service, though browser storage differs by origin.
- **401/403:** inspect key validity, project access and API restrictions in AI Studio. Keep the key out of diagnostics. Authentication failures should be corrected before another run.
- **404 / unavailable model:** verify the exact upstream ID and the project's model access. A catalog entry alone does not prove account access.
- **429:** inspect the actual project limits and retry interval. Wait for quota recovery or explicitly choose another free model. No paid provider or credit purchase is enabled automatically.
- **Tool schema or continuation error:** capture sanitized TrueForge events and correct the integration before claiming the task passed. Catalog support is not a successful tool roundtrip.

## Acceptance still required

A saved provider proves configuration, not task completion. First verify streaming plus a read/tool roundtrip, then run the exact A/B/C prompts against the prepared separate Flask checkouts. Record the actual model, quota failures, usage, reviewed patches and checks. Do not substitute fixture receipts or a hand-authored Flask patch for live model evidence.

## Observed trial constraints

Rechecked 31 October 2026: Google's [current release notes](https://ai.google.dev/gemini-api/docs/changelog) say `gemini-3.7-flash` requests route to `gemini-3.8-flash`, and `gemini-3.5-flash` requests route to `gemini-3.6-flash`. Treating those saved aliases as independent fallback capacity is not justified. [Gemini 3.1 Pro Preview has no free Gemini API tier](https://ai.google.dev/gemini-api/docs/gemini-3/); its presence in the local catalog is not permission to spend. The [2.5 family is restricted to prior active users](https://ai.google.dev/gemini-api/docs/deprecations), so it is not a reliable new-project escape from exhausted quotas. No paid model was called during this recheck.

The saved Google provider has now been verified and real editor tool calls have run through it. Initial trials encountered Flash capacity errors, explicit per-minute quotas, and incomplete model-generated documentation. These are recorded as incomplete attempts, not task passes. Exact account quotas observed in those errors are local measurements and are not promises for another project.

The integration now exposes the small editor tool set directly. This removes the redundant discovery requests observed with TrueForge's partial preload instructions. Valid quota retry hints are respected by extension recovery; a hint longer than two minutes stops automatic recovery. TrueForge's own internal transport retries are a separate layer. A provider's free context window is not an allowance to exceed its request/token rate limits.
