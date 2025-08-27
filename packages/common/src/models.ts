import { z } from 'zod'

// IVR Option within a Node
export const OptionSchema = z.object({
  digit: z.string().min(1),
  label: z.string().min(1),
  targetNodeId: z.string().nullable(),
})
export type Option = z.infer<typeof OptionSchema>

// Recursive Node schema for IVR tree
export type Node = {
  id: string
  parentId: string | null
  promptText: string
  confidence: number
  options: Option[]
  children: Node[]
}

export const NodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    parentId: z.string().nullable().default(null),
    promptText: z.string(),
    confidence: z.number().min(0).max(1),
    options: z.array(OptionSchema),
    children: z.array(NodeSchema),
  })
)

// Session model capturing discovery runs
export const SessionStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'failed',
])
export type SessionStatus = z.infer<typeof SessionStatusSchema>

export const SessionSchema = z.object({
  id: z.string().min(1),
  phone: z.string().min(1),
  status: SessionStatusSchema,
  rootNodeId: z.string().nullable(),
})
export type Session = z.infer<typeof SessionSchema>

// Call record as returned from Bland & stored in history
export const CallSchema = z.object({
  callId: z.string().min(1),
  sessionId: z.string().min(1),
  answered_by: z.string().optional(),
  transcript: z.string().optional().default(''),
  price: z.number().nonnegative().optional().default(0),
  status: z.string().min(1),
})
export type Call = z.infer<typeof CallSchema>

// Endpoint IO Schemas

// POST /discover
export const DiscoverInputSchema = z.object({
  phone: z.string().min(1),
})
export type DiscoverInput = z.infer<typeof DiscoverInputSchema>

export const DiscoverOutputSchema = z.object({
  sessionId: z.string().min(1),
})
export type DiscoverOutput = z.infer<typeof DiscoverOutputSchema>

// GET /tree/:sessionId
export const TreeOutputSchema = z.object({
  sessionId: z.string().min(1),
  root: NodeSchema,
})
export type TreeOutput = z.infer<typeof TreeOutputSchema>

// POST /refine/:nodeId
export const RefineInputSchema = z.object({
  nodeId: z.string().min(1),
})
export type RefineInput = z.infer<typeof RefineInputSchema>

export const RefineOutputSchema = NodeSchema
export type RefineOutput = z.infer<typeof RefineOutputSchema>

// GET /call-history/:sessionId
export const CallHistoryOutputSchema = z.array(CallSchema)
export type CallHistoryOutput = z.infer<typeof CallHistoryOutputSchema>
