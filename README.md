# Bland Interactive Voice Response (IVR) Discovery

## Overview

This MVP system discovers and visualizes an IVR (phone tree) structure by programmatically calling a target phone number via the Bland AI API, parsing transcripts to extract menu options, and building a tree representation. The agent runs a deterministic loop — Plan → Call → Analyze — with a single call in flight at any time, up to a configurable maximum number of calls (default 10).

Core flow:

1. Call a phone number with Bland API.
2. Detect if recipient is an IVR (`answered_by` field).
3. Parse transcript to extract options ("press 1 for sales...").
4. Store results as nodes in a tree.
5. Visualize the tree in a simple frontend UI.

## Backend (Hono.js API Server)

### Responsibilities

* Manage IVR discovery sessions.
* Call Bland API to place/track calls.
* Parse transcripts into structured nodes/options.
* Expose tree + call history via REST API.

### Endpoints

* **POST /discover**

  * Action: Initiates discovery session, places initial call.
  * Input/Output Models:

```json
Input: {
  "phone": "string (e.g. +1...)"
}

Output: {
  "sessionId": "string"
}
```

* **GET /tree/:sessionId**

  * Action: Retrieve discovered tree structure for a session.
  * Input/Output Models:

```json
Output: {
  "sessionId": "string",
  "root": {
    "id": "string",
    "promptText": "string",
    "confidence": "number",
    "options": [ { "digit": "string", "label": "string", "targetNodeId": "string|null" } ],
    "children": [Node...]
  }
}
```

* **POST /refine/:nodeId**

  * Action: Re-runs exploration of a specific node.
  * Input/Output Models:

```json
Input: { "nodeId": "string" }

Output: {
  "id": "string",
  "promptText": "string",
  "confidence": "number",
  "options": [ { "digit": "string", "label": "string", "targetNodeId": "string|null" } ],
  "children": [Node...]
}
```

* **GET /call-history/:sessionId**

  * Action: Return list of calls made in a session.
  * Input/Output Models:

```json
Output: [ {
  "callId": "string",
  "sessionId": "string",
  "answered_by": "string",
  "transcript": "string",
  "price": "number",
  "status": "string"
} ]
```

### Minimal Discovery Algorithm

* Plan: compute a path to follow (e.g., from a target node or default to first option at each level).
* Call: place one call at a time with the plan; wait for the prompt to finish; respond only with digits as needed.
* Analyze: ingest transcript, extract options, log the digit taken, and determine outcome (submenu, operator, voicemail, dead end).
* Iterate: extend the plan deterministically for the next unvisited path and repeat until all paths are explored or the maximum call count is reached.

### Data Model (simplified)

```
Session {
  id, phone, status, rootNodeId, calls[]
}
Node {
  id, parentId, promptText, options[{digit,label,nodeId}], confidence
}
Call {
  id, sessionId, answered_by, transcript, price, status
}
```

### Bland Pathways Integration (Flow & Endpoints)

**Goal**: use Bland’s Pathways + Calls API to run a deterministic Plan → Call → Analyze loop: place calls, detect IVRs, fetch high‑quality transcripts, and update the tree.

**Core endpoints we will call**

1. **POST /v1/calls** — start a call with a Pathway agent. Key body fields: `phone_number`, `pathway_id`, `wait_for_greeting: true`, optional `voicemail_detect`, `max_duration`, `record: true`. Returns `id`.
2. **GET /v1/calls/{id}** — poll call status and retrieve `answered_by`, `status`, `price`, `recording_url`, `concatenated_transcript`, and granular `transcripts`.
3. **GET /v1/calls/{id}/correct** — fetch corrected & aligned transcripts (preferred for parsing).
4. **GET /v1/calls** — list recent calls (optional, for history reconciliation).
5. **POST /v1/postcall/webhooks/create** *(optional)* — push completed call payloads to our backend instead of polling.

> Note: The **Bland Turbo** model excludes IVR navigation; we will use the default model for IVR flows and enable `wait_for_greeting` to avoid speaking first.

**Pathways usage (minimal for MVP)**

* Create a single, simple Pathway that keeps the agent silent unless it needs to select a menu option. The agent should: (a) listen for the full prompt, (b) if we instruct it to choose an option, say the word (e.g., “one”) to navigate (most IVRs accept spoken digits), and (c) end the call if silence/timeout or terminal message is detected. Sending spoken digits is sufficient for many IVRs.
* We set `record: true` so we can access corrected transcripts later.

**Plan → Call → Analyze loop (single call in flight; max calls cap)**

1. **Plan**: determine the next path to traverse. If a runtime target path is provided (e.g., `1 → 2 → 4`), follow it. Otherwise, choose the first available option at each level that remains unvisited.
2. **Call**: start `POST /v1/calls` with the agent configured to stay silent, listen fully, then speak only the required digit word (e.g., "one").
3. **Analyze**: poll `GET /v1/calls/{id}` (and prefer `GET /v1/calls/{id}/correct`) to collect transcripts, extract options, and determine whether the branch ended (operator/voicemail/dead end) or leads to another menu.
4. **Persist**: record call details, update/add nodes, and mark the traversed path as visited.
5. **Repeat** until all deterministically enumerated paths from discovered menus have been traversed or the maximum total call count is reached.

**Concurrency & queue**

* Single in‑flight call at all times. Maintain a deterministic queue (or stack) of planned paths and dispatch the next call only after the previous completes.
* A configurable `maxCalls` (default 10) caps total calls per session. Terminate when all enumerated paths are visited or when `maxCalls` is hit.

**What we read from Bland per call**

* `answered_by`, `status`, `price`, `concatenated_transcript`, `transcripts[]`, optional `recording_url`, and (if Pathway) `pathway_logs`. These fields power confidence scoring, history, and visualization.

## Frontend (Next.js App)

### Responsibilities

* Provide input to start discovery.
* Show progress (calls made / budget).
* Display discovered IVR tree interactively.
* Allow refinement of nodes.

### Features

* **Discovery Controls**

  * Input phone number, Start button, Progress indicator.
* **Tree Visualization**

  * Simple collapsible tree (use D3.js hierarchy).
  * Nodes show: prompt text, option digit, confidence color.
* **Node Inspector**

  * On click: show transcript + refine button.

### Visualization Rules

* Green = high confidence, Orange = low confidence.
* Expand/collapse for submenus.

## Constraints & Simplifications

* Maximum total calls per session = 10 (default; configurable).
* Single call at a time; deterministic traversal plan.
* Regex-based transcript parsing only.
* No caching, no advanced NLP.
* Cost tracking = sum of `price` field from Bland API responses.

## MVP Success Criteria

* Able to start a discovery session for a number.
* System makes calls and builds a small tree.
* Frontend displays tree clearly.
* User can refine a branch.
* Basic cost/progress feedback shown.

***

## At‑a‑glance Flow

1. Start a discovery session with `POST /discover { phone }`.
2. Place a root call via Bland; detect `answered_by`.
3. Prefer corrected transcript; parse options like "press 1 for sales".
4. Execute a single-call Plan → Call → Analyze loop; plan next path deterministically.
5. Persist calls and nodes; visualize the tree via `GET /tree/:sessionId`.
6. Refine any node with `POST /refine/:nodeId` (re‑explore that path).

## Bland API Interaction (Summary)

* `POST /v1/calls`: start a call with a Pathway agent (`phone_number`, `pathway_id`, `wait_for_greeting: true`, `voicemail_detect: true`, `record: true`, `max_duration`).
* `GET /v1/calls/{id}`: poll `status`, `answered_by`, `price`, `concatenated_transcript`, `transcripts`.
* `GET /v1/calls/{id}/correct`: get corrected/aligned transcript (preferred for parsing).
* Optional: `GET /v1/calls` (history) and `POST /v1/postcall/webhooks/create` (async completion).

## Sequential Plan → Call → Analyze (Summary)

* Deterministic planning of the next path: follow provided runtime path; otherwise take the first unvisited option at each level.
* Single in‑flight call; dispatch the next only after completion.
* Terminate when all discovered paths are traversed or when the maximum total calls cap is reached.

## IVR Agent Behavior (Concise Prompt Template)

```
You are exploring an automated phone menu (IVR).

Listen first
- Stay silent until the full prompt finishes. Record all options exactly.

Path traversal
- If a target path is provided (e.g., 1 → 2 → 4), follow that option at the correct level.
- If no path is provided for the current level, choose the first available option.

Respond only with digits
- Speak only digit words when required ("one", "two", ...). No chit‑chat.

End conditions
- On operator/voicemail/dead end or unsupported input request, say: "thank you, ending call now" and end.

Limits
- Run one call at a time. Stop when all paths are visited or when max total calls is reached.
```

## Persistence & Refine (Summary)

* Persist after every call: `Call` (status, price, transcript), update `Node` (prompt, options, confidence), and session cost.
* `pathDigits[]` stored on `Node` enables `POST /refine/:nodeId` to re‑navigate and update that branch.

## Detailed Spec

For full details on Bland API usage, BFS/queueing, parsing rules, persistence, and refine behavior, see:

* `docs/ivr-discovery.md`
