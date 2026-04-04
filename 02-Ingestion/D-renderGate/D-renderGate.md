# D-renderGate

Render path using headless browser or Cloudflare Browser Rendering for JavaScript-rendered pages. This is the last resort before giving up on a source.

## Purpose

Some pages render their event listings entirely in JavaScript, producing no meaningful HTML for C2-htmlGate to analyze. D-renderGate executes the page in a headless environment to get the fully rendered DOM.

## Trade-offs

- **High latency** — waiting for full page render adds seconds per source
- **High cost** — headless browser instances are resource-intensive
- **Cloudflare circumvention** — some sites block headless; Cloudflare Browser Rendering can bypass this

From `goals-detailed.md`: Cloudflare Browser Rendering when needed, but treat as last resort due to latency and cost.

## Tools

Cloudflare adapter exists in `services/ingestion/src/fetch/`.

## Current Status

**Cloudflare adapter exists.** D-renderGate as a distinct pipeline step is not yet wired in. Integration is pending — it should be invoked only when C2-htmlGate returns no events on a page that is suspected to be JS-rendered.
