import { google } from '@ai-sdk/google'
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

const model = google('gemini-2.5-flash')

/**
 * Calls Gemini 2.5 Flash via Vercel AI SDK to extract nodes from a transcript.
 * Returns a flat list of nodes with parent references and 1-100 confidence.
 */
export async function extractNodesWithLLM(
  transcript: TranscriptMessage[]
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
    'Output JSON shape:',
    '{ "nodes": [ {"id":"string","type":"menu|option|end|message","content":"string","parent":"string|null","digit?":"string","label?":"string","confidence":1-100} ] }',
  ].join('\n')

  const { object } = await generateObject({
    model,
    system,
    prompt: user,
    schema: LLMExtractedNodesSchema,
  })

  return object.nodes
}
