import { z } from 'zod'
import { getCallTranscript } from './bland'
import type { TranscriptMessage } from './bland/transcript'
import { type ExtractResult, extractAndMergeGraph } from './extract'
import type { Node } from './models'

export const DiscoverInputSchema = z.object({
  callId: z.string().min(1),
  currentRoot: z.object({}).loose().optional(),
})
export type DiscoverInput = z.infer<typeof DiscoverInputSchema>

export class DiscoverService {
  async run(input: DiscoverInput): Promise<ExtractResult | { error: string }> {
    const parsed = DiscoverInputSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.message }
    }
    const { callId } = parsed.data

    const transcript = await getCallTranscript(callId)
    if ('error' in transcript) {
      return { error: transcript.error }
    }

    const currentRoot =
      (parsed.data.currentRoot as Node | undefined) || undefined
    const result = await extractAndMergeGraph(
      transcript as TranscriptMessage[],
      currentRoot
    )

    return result
  }
}
