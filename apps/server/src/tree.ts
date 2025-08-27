import { type Node, type Option } from './models'

type RenderOptions = {
  includeNodeIds?: boolean
  includeConfidence?: boolean
  maxPromptChars?: number
}

const DEFAULT_RENDER_OPTIONS: Required<RenderOptions> = {
  includeNodeIds: true,
  includeConfidence: true,
  maxPromptChars: 200,
}

type ActionToken =
  | 'ROOT'
  | 'MENU'
  | 'END'
  | 'PENDING'
  | 'ANSWER_IVR'
  | 'ANSWER_HUMAN'

function determineNodeAction(node: Node): ActionToken {
  if (!node || !Array.isArray(node.options) || node.options.length === 0) {
    return 'END'
  }
  return node.parentId === null ? 'ROOT' : 'MENU'
}

function formatConfidence(confidence: number | undefined): string {
  if (typeof confidence !== 'number') return ''
  const clamped = Math.max(0, Math.min(1, confidence))
  return `conf=${clamped.toFixed(2)}`
}

function formatNodeHeader(
  node: Node,
  action: ActionToken,
  opts: Required<RenderOptions>
): string {
  const parts: string[] = [`<${action}>`]
  if (opts.includeNodeIds) parts.push(`id=${node.id}`)
  if (opts.includeConfidence) parts.push(formatConfidence(node.confidence))
  return parts.filter(Boolean).join(' ')
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

function formatPrompt(prompt: string, maxChars: number): string {
  const cleaned = normalizeWhitespace(prompt)
  return truncate(cleaned, maxChars)
}

function tryParseDigit(digit: string): number | null {
  const n = Number.parseInt(digit, 10)
  return Number.isNaN(n) ? null : n
}

function sortOptionsStable(options: Option[]): Option[] {
  return [...options].sort((a, b) => {
    const an = tryParseDigit(a.digit)
    const bn = tryParseDigit(b.digit)
    if (an !== null && bn !== null) return an - bn
    if (an !== null) return -1
    if (bn !== null) return 1
    // fallback to lexicographic by digit then label
    const d = a.digit.localeCompare(b.digit)
    if (d !== 0) return d
    return a.label.localeCompare(b.label)
  })
}

function buildChildIndex(node: Node): Map<string, Node> {
  const map = new Map<string, Node>()
  for (const child of node.children || []) {
    map.set(child.id, child)
  }
  return map
}

function makeBranchPrefix(prefix: string, isLast: boolean): string {
  return `${prefix}${isLast ? '└─' : '├─'}`
}

function makeChildPrefix(prefix: string, isLast: boolean): string {
  return `${prefix}${isLast ? '  ' : '│ '}`
}

function renderOptionLine(
  option: Option,
  hasChild: boolean,
  prefix: string,
  isLast: boolean
): string {
  const branch = makeBranchPrefix(prefix, isLast)
  const right = hasChild ? '' : ' -> <PENDING>'
  return `${branch} [${option.digit}] ${option.label}${right}`
}

function renderNode(
  node: Node,
  prefix: string,
  opts: Required<RenderOptions>
): string {
  const lines: string[] = []
  const action = determineNodeAction(node)
  const header = formatNodeHeader(node, action, opts)
  lines.push(`${prefix}${header}`)
  const prompt = formatPrompt(node.promptText || '', opts.maxPromptChars)
  if (prompt) {
    lines.push(`${prefix}"${prompt}"`)
  }

  if (!node.options || node.options.length === 0) {
    return lines.join('\n')
  }

  const sortedOptions = sortOptionsStable(node.options)
  const childIndex = buildChildIndex(node)

  sortedOptions.forEach((opt, idx) => {
    const isLast = idx === sortedOptions.length - 1
    const child = opt.targetNodeId
      ? childIndex.get(opt.targetNodeId)
      : undefined
    const hasChild = Boolean(child)
    lines.push(renderOptionLine(opt, hasChild, prefix, isLast))
    const childPrefix = makeChildPrefix(prefix, isLast)
    if (child) {
      // Nest the child node under the option line
      const nested = renderNode(child, childPrefix, opts)
      lines.push(nested)
    }
  })

  return lines.join('\n')
}

export function renderIvrTreeAsText(
  root: Node,
  options?: RenderOptions
): string {
  const opts = { ...DEFAULT_RENDER_OPTIONS, ...(options || {}) }
  return renderNode(root, '', opts)
}
