import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import type { TranscriptMessage } from '@/bland/transcript'

// LLM extracted node schema (flat, parent-linked). Confidence as 1-100.
export const LLMExtractedNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['menu', 'option', 'end', 'message']),
  content: z.string().default(''),
  parent: z.string().nullable().default(null),
  digit: z.string().optional(),
  label: z.string().optional(),
  confidence: z.number().int().min(1).max(100),
})

export type LLMExtractedNode = z.infer<typeof LLMExtractedNodeSchema>

export const LLMExtractedNodesSchema = z.object({
  nodes: z.array(LLMExtractedNodeSchema),
})

const model = openai('gpt-5')

/**
 * Calls Gemini 2.5 Flash via Vercel AI SDK to extract nodes from a transcript.
 * Returns a flat list of nodes with parent references and 1-100 confidence.
 */
export async function extractNodesWithLLM(
  transcript: TranscriptMessage[],
  treeText?: string
): Promise<LLMExtractedNode[]> {
  const system = [
    'You extract IVR phone menu trees from transcripts.',
    'Return a flat list of nodes (menu, option, end, message) with parent links.',
    'Rules:',
    '- A root menu has parent = null and type = "menu".',
    '- Options are children of the menu they belong to; include digit and label.',
    '- A submenu is a child node with type = "menu".',
    '- Terminal messages are type = "end" (e.g., operator, voicemail, or final info).',
    '- Include a confidence integer 1-100 for each node.',
    'Only return JSON matching the provided schema. No extra commentary.',
  ].join('\n')

  const user = [
    'Transcript (array of role/message objects):',
    JSON.stringify(transcript, null, 2),
    '',
    'Current IVR Tree (ASCII) for context (if provided):',
    treeText || '',
    '',
    'Output JSON shape:',
    '{ "nodes": [ {"id":"string","type":"menu|option|end|message","content":"string","parent":"string|null","digit?":"string","label?":"string","confidence":1-100} ] }',
  ].join('\n')

  const { object } = await generateObject({
    model,
    system,
    prompt: user,
    schema: LLMExtractedNodesSchema,
    temperature: 0.25,
  })

  return object.nodes
}

export const PlanSchema = z.object({
  summary: z.string().min(1),
  nextPath: z.array(z.string().min(1)).default([]),
  terminalType: z
    .enum(['none', 'operator', 'voicemail', 'dead_end', 'info_provided'])
    .default('none'),
  notes: z.string().optional().default(''),
})
export type PlanResult = z.infer<typeof PlanSchema>

export async function summarizeAndPlanNext(
  transcript: TranscriptMessage[],
  treeText: string,
  isFirstRun: boolean,
  visitedPaths: string[][],
  pendingPaths: string[][],
  recentPaths: string[][]
): Promise<PlanResult> {
  const system = [
    'You plan the next call for an IVR discovery agent that explores a phone menu tree.',
    'Given the latest transcript and the current IVR tree (ASCII), produce:',
    '- A concise 1-3 sentence summary of what happened (no fluff).',
    '- nextPath: an array of digits to explore next, prioritizing unexplored (PENDING) branches.',
    '- terminalType: operator | voicemail | dead_end | info_provided | none.',
    '',
    'Planning policy:',
    '- If the last attempt reached a terminal or an unexpected branch, backtrack in the tree to the nearest ancestor menu with an unexplored option and select that next.',
    '- Avoid re-traversing already explored branches; do not loop.',
    '- Prefer numeric option order when multiple unexplored options are available.',
    '- If the tree shows no remaining PENDING options, return an empty nextPath.',
  ].join('\n')

  const user = [
    `First run: ${isFirstRun ? 'yes' : 'no'}`,
    'Transcript:',
    JSON.stringify(transcript, null, 2),
    'Current IVR Tree (ASCII):',
    treeText,
    '',
    'Visited paths (fully explored):',
    JSON.stringify(visitedPaths, null, 2),
    'Pending paths (to explore):',
    JSON.stringify(pendingPaths, null, 2),
    'Recently explored/planned paths (most recent first):',
    JSON.stringify(recentPaths, null, 2),
    'PRIORITIZE UNEXPLORED OPTIONS. DO NOT KEEP TRAVERSING THE SAME PATH.',
  ].join('\n')

  const { object } = await generateObject({
    model,
    system,
    prompt: user,
    schema: PlanSchema,
    temperature: 0.1,
  })

  return object
}
