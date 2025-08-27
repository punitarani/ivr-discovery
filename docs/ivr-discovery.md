## IVR Discovery with Bland API (Spec)

### Goal

Build an automated explorer that calls a target phone number, detects IVR menus, parses options, and constructs a navigable tree. Keep it minimal, reliable, and cost‑aware.

### System Boundaries

* **Backend API (Hono.js)**: Use only existing endpoints: `POST /discover`, `GET /tree/:sessionId`, `POST /refine/:nodeId`, `GET /call-history/:sessionId`.
* **Frontend (Next.js)**: Starts discovery, displays progress and an interactive tree, triggers refine actions.
* **Persistence**: Store sessions, nodes, and calls to support replay, refine, and history.

### Environment

* **BLAND\_API\_KEY** must be set in `.env`. The app loads env via `src/env.ts` and makes authorized HTTPS calls to Bland APIs.

***

### Backend API Contract (ours)

* **POST `/discover`**
  * **Body**:
    ```json
    { "phone": "+1XXXXXXXXXX" }
    ```
  * **Response**:
    ```json
    { "sessionId": "string" }
    ```
  * **Behavior**: Creates a session; seeds the exploration queue with the root job `{digits: [], depth: 0}`; starts calling.

* **GET `/tree/:sessionId`**
  * **Response (shape)**:
    ```json
    {
      "sessionId": "string",
      "root": {
        "id": "string",
        "promptText": "string",
        "confidence": 0.0,
        "options": [ { "digit": "string", "label": "string", "targetNodeId": "string|null" } ],
        "children": [ /* Node... */ ]
      }
    }
    ```

* **POST `/refine/:nodeId`**
  * **Body**:
    ```json
    { "nodeId": "string" }
    ```
  * **Behavior**: Enqueues a focused re‑exploration job for the node, using the stored path to re‑navigate.

* **GET `/call-history/:sessionId`**
  * **Response (shape)**:
    ```json
    [ {
      "callId": "string",
      "sessionId": "string",
      "answered_by": "ivr|human|voicemail|unknown",
      "transcript": "string",
      "price": 0.0,
      "status": "queued|in_progress|completed|failed"
    } ]
    ```

***

### Bland API Integration

* **Auth**: `Authorization: Bearer ${BLAND_API_KEY}`

* **Core endpoints** we will use:
  * **POST `/v1/calls`** – start a call via a Pathway agent.
    * Suggested fields: `phone_number`, `pathway_id`, `wait_for_greeting: true`, `voicemail_detect: true`, `max_duration` (cap cost), `record: true`.
    * Returns `call_id`.
  * **GET `/v1/calls/{call_id}`** – poll for `status`, `answered_by`, `price`, `concatenated_transcript`, and granular `transcripts`.
  * **GET `/v1/calls/{call_id}/correct`** – fetch corrected/aligned transcript (preferred for parsing). Fallback to `concatenated_transcript`.
  * **GET `/v1/calls`** – list recent calls (optional, for history reconciliation).
  * **POST `/v1/postcall/webhooks/create`** – optional webhook to push completion events; otherwise we poll.

* **Pathway behavior (minimal)**:
  * Stay silent and listen for the full IVR prompt.
  * When instructed to select an option, speak the word for the digit (e.g., say "one"). Many IVRs accept spoken digits.
  * End if terminal message or timeout.

***

### Discovery Flow (BFS + Concurrency)

* **Limits**: `maxDepth = 10`, `maxBreadthPerNode = 10`, `maxTotalCalls = 10`, `maxInflightCalls = 10`.

* **Job shape**:
  ```json
  {
    "sessionId": "string",
    "digits": ["1","2"],
    "depth": 2,
    "parentNodeId": "string|null"
  }
  ```

* **BFS queue**:
  * Maintain a FIFO queue of jobs.
  * Maintain a semaphore `inflight <= 10` to cap concurrent calls.
  * Each completed/failed call decrements the semaphore and dispatches the next queued job.

* **Root**:
  1. Enqueue `{digits: [], depth: 0}` and start a call with the agent configured to only listen.
  2. If `answered_by != "ivr"`, mark the node terminal and stop that branch.
  3. Prefer corrected transcript; fallback if unavailable.
  4. Parse options with regex; score confidence.
  5. For each option (up to breadth cap), create child node and enqueue `{digits: [..., d], depth+1}`.

* **Child navigation**:
  * Start a call; agent waits for menu, then speaks the selected digit word (e.g., "one").
  * Repeat parse/enqueue until depth/budget/terminal conditions.

* **Stop conditions**:
  * Terminal phrases (e.g., "goodbye", "transferring").
  * Repeated menus (loop detection via prompt hash or option signature).
  * Depth, breadth, or total call budget reached.

***

### Transcript Parsing (Regex‑only MVP)

* **Patterns** (examples):
  * `press\s*(?<digit>[0-9])\s*(for|to)\s*(?<label>[a-zA-Z\-\s]+)`
  * `(for|to)\s*(?<label>[a-zA-Z\-\s]+)\s*(press|dial)\s*(?<digit>[0-9])`
  * `(say)\s*(?<label>[a-zA-Z\-\s]+)\s*(or)\s*(press)\s*(?<digit>[0-9])`
* **Confidence**: heuristic blend of keyword presence, option count sanity (≤10), and transcript source (corrected > raw).

***

### Persistence Model

* **Session**: `{ id, phone, status, rootNodeId, calls[], costTotal, createdAt }`

* **Node**: `{ id, sessionId, parentId, promptText, options[{ digit, label, nodeId }], confidence, depth, pathDigits[] }`

* **Call**: `{ id, sessionId, nodeId, answered_by, transcript, price, status, createdAt }`

* **Updates**:
  * After each call: persist call record, update/insert node, recalc `costTotal`.
  * Link `options[].nodeId` to created child nodes; maintain `children[]` in the tree view model.

***

### Refine / Re‑explore

* **Trigger**: `POST /refine/:nodeId` enqueues a new job using the node's `pathDigits[]` to reach the menu again.
* **Behavior**:
  * Run the same parse flow; overwrite `promptText/options/confidence` for the node; merge children if structure changed.
  * Persist another call record (do not delete history).
  * Rebuild `GET /tree/:sessionId` view from canonical Node graph.

***

### Cost & Progress

* **Cost**: Sum `price` from Bland responses across the session (`costTotal`).
* **Progress**: Track `queued`, `in_progress`, `completed`, `failed` counts; expose in frontend.

***

### Operational Notes

* **Polling vs Webhooks**: Poll `GET /v1/calls/{id}` until status terminal; optionally register a webhook to push completions and reduce polling.
* **Timeouts/Max Duration**: Set conservative `max_duration` per call to bound spend.
* **Idempotency**: Use a deterministic job key (sessionId + pathDigits) to avoid duplicate exploration on retries.
