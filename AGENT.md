# Agent Outline

The agent is provided:

1. Phone number
2. Calling context (who/what we are calling)
3. Caller metadata (info about the user on whose behalf we call)

## Agent Structure

1. Make a task-based call (no Pathway)

```request
curl --request POST \
  --url https://api.bland.ai/v1/calls \
  --header 'Authorization: Bearer <BLAND_API_KEY>' \
  --header 'Content-Type: application/json' \
  --data '{
  "phone_number": "+1XXXXXXXXXX",
  "task": "You are exploring an automated phone menu (IVR). Stay silent until the menu finishes. Record all options. If a target path is provided, follow it at each level. If no path is provided for this level, choose the first available option. Respond only with digit words when required (\"one\", \"two\"). If you reach operator/voicemail/dead end or unsupported input request, say: \"thank you, ending call now\" and end.",
  "wait_for_greeting": true,
  "voicemail_detect": true,
  "record": true,
  "max_duration": 180
}'
```

```response
{
  "status": "success",
  "call_id": "9d404c1b-6a23-4426-953a-a52c392ff8f1"
}
```

2. Analyze results and plan next path

* Poll `GET /v1/calls/{call_id}` to check `status`, `answered_by`, `price`, `concatenated_transcript`, and `transcripts`.
* Prefer `GET /v1/calls/{call_id}/correct` for corrected/aligned transcripts if available.
* Parse the transcript to extract menu options and determine the outcome (submenu, operator, voicemail, dead end).
* Build or update the IVR tree: node prompt, options (digit → label), and terminal states.
* Use a deterministic strategy to plan the next path:
  * If a specific target path is provided at runtime, follow it.
  * Otherwise, choose the first unvisited option at each level.

3. Repeat (Plan → Call → Analyze)

* Run a single call at a time.
* Stop when all deterministically enumerated paths have been traversed to their terminal states, or when the maximum total calls cap is reached (default 10).

## Notes

* Keep the agent silent by default; respond only with digit words when input is required.
* No chit-chat or small talk; the goal is to map the IVR precisely.
* You may use Gemini (or another LLM) to analyze transcripts and verify whether the explored branch covered all available options. If not, update the next task with the planned path and continue.
