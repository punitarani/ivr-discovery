import type { TranscriptMessage } from './bland/transcript'
import { extractNodesWithLLM, type LLMExtractedNode } from './llm'
import type { Node, Option } from './models'
import { renderIvrTreeAsText } from './tree'

export type Graph = Node

function ensureOption(node: Node, digit: string, label: string): Option {
  const existing = node.options.find(
    (o) => o.digit === digit && o.label === label
  )
  if (existing) return existing
  const opt: Option = { digit, label, targetNodeId: null }
  node.options.push(opt)
  return opt
}

function upsertChild(parent: Node, child: Node): Node {
  const byId = new Map(parent.children.map((c) => [c.id, c] as const))
  const existing = byId.get(child.id)
  if (existing) {
    existing.promptText = child.promptText || existing.promptText
    existing.confidence = Math.max(existing.confidence, child.confidence)
    // merge options shallowly; avoid duplicates
    const seen = new Set(existing.options.map((o) => `${o.digit}|${o.label}`))
    for (const o of child.options) {
      const key = `${o.digit}|${o.label}`
      if (!seen.has(key)) existing.options.push(o)
    }
    // children will be merged in subsequent upserts via traversal
    return existing
  }
  parent.children.push(child)
  return child
}

function createMenuNode(
  id: string,
  parentId: string | null,
  content: string,
  confidencePct: number
): Node {
  return {
    id,
    parentId,
    promptText: content,
    confidence: Math.max(0, Math.min(1, confidencePct / 100)),
    options: [],
    children: [],
  }
}

function createEndNode(
  id: string,
  parentId: string | null,
  content: string,
  confidencePct: number
): Node {
  return {
    id,
    parentId,
    promptText: content,
    confidence: Math.max(0, Math.min(1, confidencePct / 100)),
    options: [],
    children: [],
  }
}

export type ExtractResult = {
  root: Node
  extracted: LLMExtractedNode[]
}

/**
 * Extract/merge graph from transcript using LLM. If current graph is missing,
 * a new root is inferred from the first menu node returned by the LLM.
 */
export async function extractAndMergeGraph(
  transcript: TranscriptMessage[],
  currentRoot?: Node
): Promise<ExtractResult> {
  // 1) Deterministic parse first (regex + pressed button flow)
  const parsedRoot = buildGraphDeterministic(transcript, currentRoot)

  // 2) Optionally call LLM for additional nodes/validation (low-temp)
  // Keep for future enhancement; for now, prefer deterministic output for accuracy.
  let extracted: LLMExtractedNode[] = []
  try {
    const treeText = currentRoot ? renderIvrTreeAsText(currentRoot) : undefined
    extracted = await extractNodesWithLLM(transcript, treeText)
  } catch {
    // Ignore LLM failures for MVP
  }

  return { root: parsedRoot, extracted }
}

// ------------------------- Deterministic builder -------------------------

const PRESS_AFTER_LABEL_RE =
  /^(?<label>.+?)\s*,?\s*(?:press|dial)\s*(?<digit>[0-9])\b/iu
const PRESS_BEFORE_LABEL_RE =
  /\b(?:press|dial)\s*(?<digit>[0-9])\b\s*(?:for|to)\s*(?<label>.+)$/iu

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseOptions(text: string): { digit: string; label: string }[] {
  const sentences = splitSentences(text)
  const results: { digit: string; label: string }[] = []
  const seen = new Set<string>()

  for (const s of sentences) {
    let digit = ''
    let label = ''
    let m = PRESS_AFTER_LABEL_RE.exec(s)
    if (m) {
      digit = (m.groups?.digit || '').trim()
      label = (m.groups?.label || '').trim()
    } else {
      m = PRESS_BEFORE_LABEL_RE.exec(s)
      if (m) {
        digit = (m.groups?.digit || '').trim()
        label = (m.groups?.label || '').trim()
      } else {
        const m2 = /\b(?:press|dial)\s*([0-9])\b/iu.exec(s)
        if (m2) {
          digit = m2[1]
          label = s.replace(/\b(?:press|dial)\s*[0-9]\b.*/iu, '').trim()
        }
      }
    }
    if (!digit) continue
    label = label
      .replace(/^if\s+/iu, '')
      .replace(/[.]+$/u, '')
      .trim()
    const key = `${digit}|${label.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push({ digit, label: label || `Option ${digit}` })
  }

  return results
}

function findFirstGreeting(transcript: TranscriptMessage[]): string {
  for (const msg of transcript) {
    if (msg.role === 'user') {
      return msg.message.trim()
    }
  }
  return 'Root'
}

function isPressEvent(msg: TranscriptMessage): {
  pressed: boolean
  digit?: string
} {
  if (msg.role !== 'assistant') return { pressed: false }
  const m = /Pressed\s*Button:\s*([0-9])/i.exec(msg.message)
  if (!m) return { pressed: false }
  return { pressed: true, digit: m[1] }
}

function buildGraphDeterministic(
  transcript: TranscriptMessage[],
  currentRoot?: Node
): Node {
  const greeting = findFirstGreeting(transcript)
  const root: Node = currentRoot || {
    id: 'ROOT',
    parentId: null,
    promptText: greeting,
    confidence: 0.95,
    options: [],
    children: [],
  }

  // State for traversal
  type StackItem = { node: Node; path: string[] }
  let current: StackItem = { node: root, path: [] }
  const stack: StackItem[] = []

  // Helper to get/create submenu node by path
  function ensureMenuNode(parent: Node, path: string[], prompt?: string): Node {
    const id = path.join('-') || 'ROOT'
    const existing = parent.children.find((c) => c.id === id)
    if (existing) {
      if (prompt) existing.promptText = prompt
      return existing
    }
    const node = createMenuNode(id, parent.id, prompt || '', 95)
    parent.children.push(node)
    return node
  }

  // Helper to link option target
  function linkOptionTarget(parent: Node, digit: string, targetId: string) {
    const opt = parent.options.find((o) => o.digit === digit)
    if (opt) opt.targetNodeId = targetId
  }

  for (let i = 0; i < transcript.length; i++) {
    const msg = transcript[i]

    const press = isPressEvent(msg)
    if (press.pressed) {
      // Move down into pressed submenu path
      const nextPath = [...current.path, press.digit as string]
      const submenuId = nextPath.join('-') || 'ROOT'
      const submenu = ensureMenuNode(current.node, nextPath)
      linkOptionTarget(current.node, press.digit as string, submenuId)
      stack.push(current)
      current = { node: submenu, path: nextPath }
      continue
    }

    if (msg.role === 'user') {
      const options = parseOptions(msg.message)
      if (options.length > 0) {
        // Treat this as a menu prompt for the current node
        current.node.promptText = msg.message.trim()
        for (const { digit, label } of options) {
          ensureOption(current.node, digit, label)
        }
      } else {
        // Terminal message under current node; create an END node
        if (current.path.length > 0) {
          const endId = `${current.path.join('-')}`
          const endNode = createEndNode(
            endId,
            current.node.id,
            msg.message.trim(),
            90
          )
          upsertChild(current.node, endNode)
        }
        // After a terminal, pop back to previous menu if any
        current = stack.pop() || { node: root, path: [] }
      }
    }
  }

  return root
}
