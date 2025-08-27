import { z } from 'zod'
import { makeCall, pollCallUntilDone } from './bland/call'
import type { TranscriptMessage } from './bland/transcript'
import {
  getCallTranscript,
  parseConcatenatedTranscript,
} from './bland/transcript'
import { type ExtractResult, extractAndMergeGraph } from './extract'
import type { Node } from './models'
import { renderIvrTreeAsText } from './tree'

export const DiscoverInputSchema = z.object({
  phone: z.string().min(1),
  minCalls: z.number().int().min(1).max(10).default(2),
  maxCalls: z.number().int().min(1).max(10).default(10),
  currentRoot: z.object({}).loose().optional(),
})
export type DiscoverInput = z.infer<typeof DiscoverInputSchema>

export class DiscoverService {
  async run(input: DiscoverInput): Promise<ExtractResult | { error: string }> {
    const parsed = DiscoverInputSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.message }
    }
    const { phone, minCalls, maxCalls } = parsed.data

    let root = (parsed.data.currentRoot as Node | undefined) || undefined
    let calls = 0
    while (calls < maxCalls) {
      const task = this.buildTaskPrompt(root)
      console.log(`[discover] iteration ${calls + 1}/${maxCalls}`)
      console.log(`[discover] task prompt ->\n${task}`)
      const mk = await makeCall(phone, task)
      if (mk.status !== 'success' || !mk.call_id) {
        return { error: mk.error_message || 'Call initiation failed' }
      }
      const callId = String(mk.call_id)
      console.log('[discover] call queued', { callId })
      const done = await pollCallUntilDone(callId, {})
      if ('error' in done) {
        const err = (done as { error: string }).error
        return { error: err }
      }
      console.log('[discover] call terminal status received', done)

      let transcript = await getCallTranscript(callId)
      if ('error' in transcript || transcript.length === 0) {
        const concat = (done as Record<string, unknown>)
          .concatenated_transcript as unknown
        if (typeof concat === 'string' && concat.trim().length > 0) {
          transcript = parseConcatenatedTranscript(concat)
        }
      }
      if ('error' in transcript) {
        return { error: transcript.error }
      }
      console.log('[discover] transcript fetched', {
        messages: (transcript as TranscriptMessage[]).length,
      })

      const { root: newRoot } = await extractAndMergeGraph(
        transcript as TranscriptMessage[],
        root
      )
      root = newRoot
      calls++

      console.log(`[discover] current IVR tree:\n${renderIvrTreeAsText(root)}`)

      if (calls >= minCalls && this.isTraversalComplete(root)) {
        console.log('[discover] traversal complete')
        break
      }
    }

    // Final render for debugging
    if (root) {
      console.log(`[discover] final IVR tree:\n${renderIvrTreeAsText(root)}`)
    }

    if (!root) return { error: 'No root built' }
    return { root, extracted: [] }
  }

  private buildTaskPrompt(root?: Node): string {
    const base = [
      'You are exploring an automated phone menu (IVR).',
      'Listen silently until the full prompt finishes. Record options exactly.',
      'If a target path is provided, follow it. Otherwise choose the first available option.',
      'Respond only with digit words when required ("one", "two", etc.).',
      'If operator/voicemail/dead end, say: "thank you, ending call now" and end.',
    ]
    const nextPath = this.nextUnvisitedPath(root)
    if (nextPath.length > 0) {
      base.push(`Target path: ${nextPath.join(' -> ')}`)
    } else {
      base.push('Target path: first available option at each level')
    }
    return base.join('\n')
  }

  private isTraversalComplete(root: Node): boolean {
    // Complete if every option has a child or no more options
    const stack: Node[] = [root]
    while (stack.length) {
      const n = stack.pop() as Node
      if (n.options.length > 0) {
        for (const o of n.options) {
          if (!o.targetNodeId) return false
        }
      }
      for (const c of n.children) stack.push(c)
    }
    return true
  }

  private nextUnvisitedPath(root?: Node): string[] {
    if (!root) return []
    // DFS find first option chain with a missing target
    const stack: { node: Node; path: string[] }[] = [{ node: root, path: [] }]
    while (stack.length) {
      const { node, path } = stack.pop() as { node: Node; path: string[] }
      // prioritize in numeric order
      const byDigit = [...node.options].sort((a, b) => {
        const an = Number.parseInt(a.digit, 10)
        const bn = Number.parseInt(b.digit, 10)
        if (Number.isNaN(an) && Number.isNaN(bn))
          return a.digit.localeCompare(b.digit)
        if (Number.isNaN(an)) return 1
        if (Number.isNaN(bn)) return -1
        return an - bn
      })
      for (const o of byDigit) {
        if (!o.targetNodeId) return [...path, o.digit]
        const child = node.children.find((c) => c.id === o.targetNodeId)
        if (child) stack.push({ node: child, path: [...path, o.digit] })
      }
    }
    return []
  }
}
