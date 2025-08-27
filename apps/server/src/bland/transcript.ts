import { z } from 'zod'
import { env } from '../env'

const Role = z.enum(['user', 'assistant', 'agent-action'])

// Transcript schema from Bland API
const TranscriptSchema = z.object({
  id: z.number(),
  created_at: z.string(),
  text: z.string(),
  user: z.string(),
  c_id: z.string().optional(),
  status: z.string().nullable().optional(),
  transcript_id: z.string().nullable().optional(),
})

// Call details response schema (contains transcripts)
const CallDetailsResponseSchema = z
  .object({
    call_id: z.string(),
    transcripts: z.array(TranscriptSchema).optional(),
    // Other fields are optional for our purposes
  })
  .loose()

export type TranscriptMessage = {
  role: z.infer<typeof Role>
  message: string
}

/**
 * Gets the call transcript as an array of simplified message objects
 * @param callId - The call ID
 * @returns Promise with transcript array or error
 */
export async function getCallTranscript(
  callId: string
): Promise<TranscriptMessage[] | { error: string }> {
  try {
    if (!callId || callId.trim() === '') {
      return { error: 'Call ID is required' }
    }

    const authHeader = env.BLAND_API_KEY.startsWith('Bearer ')
      ? env.BLAND_API_KEY
      : `Bearer ${env.BLAND_API_KEY}`

    const response = await fetch(`https://api.bland.ai/v1/calls/${callId}`, {
      method: 'GET',
      headers: {
        Authorization: authHeader,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      return { error: `HTTP ${response.status}: ${errorText}` }
    }

    const data = await response.json()
    const result = CallDetailsResponseSchema.parse(data)

    if (!result.transcripts || result.transcripts.length === 0) {
      return []
    }

    return result.transcripts.map((transcript) => ({
      role: mapRole(transcript.user),
      message: transcript.text,
    }))
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// Parse a concatenated transcript string like:
// "user: ...\n agent-action: ... \n assistant: ..."
export function parseConcatenatedTranscript(
  concatenated: string
): TranscriptMessage[] {
  const lines = concatenated
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
  const out: TranscriptMessage[] = []
  for (const line of lines) {
    const m = /^(user|assistant|agent-action)\s*:\s*(.*)$/i.exec(line)
    if (!m) continue
    const role = mapRole(m[1])
    const text = m[2].trim()
    if (text.length === 0) continue
    // Skip noisy waiting markers
    if (/^\[waiting\]/i.test(text)) continue
    out.push({ role, message: text })
  }
  return out
}

function mapRole(role: string): z.infer<typeof Role> {
  const lowerRole = role.toLowerCase().trim()

  if (lowerRole === 'user') return 'user'
  if (lowerRole === 'assistant') return 'assistant'
  if (lowerRole === 'agent-action') return 'assistant'

  // Default to assistant for any other role
  console.warn(`Unknown role: ${role}`)
  return 'assistant'
}
