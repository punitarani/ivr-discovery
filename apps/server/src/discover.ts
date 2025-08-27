import { z } from 'zod'
import { makeCall, pollCallUntilDone } from './bland/call'
import type { TranscriptMessage } from './bland/transcript'
import {
  getCallTranscript,
  parseConcatenatedTranscript,
} from './bland/transcript'
import { type ExtractResult, extractAndMergeGraph } from './extract'
import { summarizeAndPlanNext } from './llm'
import type { Node } from './models'
import {
  addSnapshot,
  appendCall,
  createEmptySession,
  loadSession,
  type PersistedSession,
  saveSession,
} from './persist'
import { renderIvrTreeAsText } from './tree'

export const DiscoverInputSchema = z.object({
  phone: z.string().min(1),
  minCalls: z.number().int().min(1).max(10).default(2),
  maxCalls: z.number().int().min(1).max(10).default(10),
  currentRoot: z.object({}).loose().optional(),
  preferredPath: z.array(z.string().min(1)).optional(),
})
export type DiscoverInput = z.infer<typeof DiscoverInputSchema>

export class DiscoverService {
  private overridePath: string[] | undefined
  async run(input: DiscoverInput): Promise<ExtractResult | { error: string }> {
    const parsed = DiscoverInputSchema.safeParse(input)
    if (!parsed.success) {
      return { error: parsed.error.message }
    }
    const { phone, minCalls, maxCalls } = parsed.data
    this.overridePath = parsed.data.preferredPath

    let session: PersistedSession =
      (await loadSession(phone)) ||
      createEmptySession(phone, { maxCalls, minCalls })
    let root =
      (parsed.data.currentRoot as Node | undefined) ||
      session.lastRoot ||
      undefined
    let calls = 0
    while (calls < maxCalls) {
      const { visitedPaths, pendingPaths } =
        this.collectVisitedAndPendingPaths(root)
      const recentPaths = this.getRecentPlannedPaths(session, 5)
      const suggested = this.suggestNextPathFromHistory(
        pendingPaths,
        recentPaths
      )
      const task = this.buildTaskPrompt(
        root,
        visitedPaths,
        pendingPaths,
        recentPaths,
        suggested
      )
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

      // Persist call + snapshot
      session = appendCall(session, {
        callId,
        status: (done as Record<string, unknown>).status as string | null,
        answered_by: (done as Record<string, unknown>).answered_by as
          | string
          | null,
        price: (done as Record<string, unknown>).price as number | null,
        startedAt: (done as Record<string, unknown>).started_at as
          | string
          | null,
        endedAt: (done as Record<string, unknown>).end_at as string | null,
        concatenatedTranscript: (done as Record<string, unknown>)
          .concatenated_transcript as string | null,
        transcript: transcript as TranscriptMessage[],
      })
      const currentTotal =
        typeof session.totalCost === 'number' &&
        Number.isFinite(session.totalCost)
          ? session.totalCost
          : session.calls.reduce((sum, c) => sum + (c.price || 0), 0)
      console.log('[discover] call cost + running total', {
        callId,
        price: (done as Record<string, unknown>).price,
        totalCost: currentTotal,
      })
      session = addSnapshot(session, root)
      await saveSession(phone, session)

      const treeText = renderIvrTreeAsText(root)
      console.log(`[discover] current IVR tree:\n${treeText}`)
      const sets = this.collectVisitedAndPendingPaths(root)
      console.log('[discover] visited paths', sets.visitedPaths)
      console.log('[discover] pending paths', sets.pendingPaths)

      // LLM plan for next call (summary + nextPath selection)
      const plan = await summarizeAndPlanNext(
        transcript as TranscriptMessage[],
        treeText,
        calls === 1,
        sets.visitedPaths,
        sets.pendingPaths,
        this.getRecentPlannedPaths(session, 10)
      )
      console.log('[discover] plan', plan)
      // persist plan into last call
      session.calls[session.calls.length - 1].planSummary = plan.summary
      session.calls[session.calls.length - 1].planNextPath = plan.nextPath
      session.calls[session.calls.length - 1].terminalType = plan.terminalType
      await saveSession(phone, session)

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

  private buildTaskPrompt(
    root: Node | undefined,
    visitedPaths: string[][],
    pendingPaths: string[][],
    recentPaths: string[][],
    suggestedNextPath: string[] | null
  ): string {
    const base = [
      'You are exploring an automated phone menu (IVR).',
      'Listen silently until the full prompt finishes. Record options exactly.',
      'If a target path is provided, follow it exactly. Only select options that have not yet been explored.',
      'Respond only with digit words when required ("one", "two", etc.).',
      'If operator/voicemail/dead end, say: "thank you, ending call now" and end.',
      '',
      'Backtracking and recovery rules:',
      '- Prefer exploring branches marked as pending/unexplored.',
      '- If the exact target option is unavailable or the menu flow deviates, backtrack to the nearest prior menu and select the next unvisited option in numeric order.',
      '- Never re-explore paths that are already known (avoid loops).',
      '- If there is a built-in option like "main menu" or "previous menu", use it to return; otherwise end the call politely so the next call can resume from root.',
      '- Explore only one branch per call; once the branch terminates, end the call.',
    ]
    const nextPath =
      (suggestedNextPath && suggestedNextPath.length > 0
        ? suggestedNextPath
        : undefined) ||
      (this.overridePath && this.overridePath.length > 0
        ? this.overridePath
        : undefined) ||
      this.nextUnvisitedPath(root)
    if (nextPath.length > 0) {
      base.push(`Target path: ${nextPath.join(' -> ')}`)
    } else {
      base.push('Target path: first pending option at each level')
    }
    if (root) {
      base.push('')
      base.push(
        'Current IVR tree (ASCII). Options with -> <PENDING> are unexplored so prioritize them and similar paths that could lead to new information.'
      )
      base.push(renderIvrTreeAsText(root))
    }
    base.push('')
    base.push('Visited paths (fully explored):')
    base.push(JSON.stringify(visitedPaths))
    base.push('Pending paths (to explore):')
    base.push(JSON.stringify(pendingPaths))
    base.push('Recently explored/planned paths (most recent first):')
    base.push(JSON.stringify(recentPaths))
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
      const childrenToPush: { node: Node; path: string[] }[] = []
      for (const o of byDigit) {
        if (!o.targetNodeId) return [...path, o.digit]
        const child = node.children.find((c) => c.id === o.targetNodeId)
        if (child)
          childrenToPush.push({ node: child, path: [...path, o.digit] })
      }
      // push in reverse so lower digits are explored first (LIFO stack)
      for (let i = childrenToPush.length - 1; i >= 0; i--) {
        stack.push(childrenToPush[i])
      }
    }
    return []
  }

  private collectVisitedAndPendingPaths(root?: Node): {
    visitedPaths: string[][]
    pendingPaths: string[][]
  } {
    const visitedPaths: string[][] = []
    const pendingPaths: string[][] = []
    if (!root) return { visitedPaths, pendingPaths }

    const stack: { node: Node; path: string[] }[] = [{ node: root, path: [] }]
    while (stack.length) {
      const { node, path } = stack.pop() as { node: Node; path: string[] }
      for (const opt of node.options || []) {
        const nextPath = [...path, opt.digit]
        if (opt.targetNodeId) {
          visitedPaths.push(nextPath)
          const child = node.children.find((c) => c.id === opt.targetNodeId)
          if (child) {
            stack.push({ node: child, path: nextPath })
          }
        } else {
          pendingPaths.push(nextPath)
        }
      }
    }
    return { visitedPaths, pendingPaths }
  }

  private getRecentPlannedPaths(
    session: PersistedSession,
    limit: number
  ): string[][] {
    const paths: string[][] = []
    if (!session || !Array.isArray(session.calls)) return paths
    for (
      let i = session.calls.length - 1;
      i >= 0 && paths.length < limit;
      i--
    ) {
      const p = session.calls[i]?.planNextPath
      if (Array.isArray(p) && p.length > 0) paths.push(p)
    }
    return paths
  }

  private suggestNextPathFromHistory(
    pendingPaths: string[][],
    recentPaths: string[][]
  ): string[] | null {
    if (!pendingPaths.length || !recentPaths.length) return null
    const pendingSet = new Set(pendingPaths.map((p) => p.join('>')))
    for (const r of recentPaths) {
      const key = r.join('>')
      if (pendingSet.has(key)) return r
    }
    return null
  }
}
