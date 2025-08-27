import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import { DiscoverService } from './discover'
import { loadSession } from './persist'

const app = new Hono()

app.use(
  '*',
  cors({
    origin: ['http://localhost:3000'],
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
  })
)

app.get('/', (c) => c.text('Hono server is running!'))

// POST /discover
app.post('/discover', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parseResult = z
    .object({
      phone: z.string().min(1),
      minCalls: z.number().int().min(1).max(10).optional(),
      maxCalls: z.number().int().min(1).max(10).optional(),
      currentRoot: z.object({}).loose().optional(),
      preferredPath: z.array(z.string().min(1)).optional(),
    })
    .safeParse(body)
  if (!parseResult.success) {
    return c.json(
      { error: 'Invalid input', details: parseResult.error.flatten() },
      400
    )
  }
  const service = new DiscoverService()
  try {
    // Fire-and-forget: start discovery without awaiting completion
    void service
      .run({
        phone: parseResult.data.phone,
        minCalls: parseResult.data.minCalls ?? 2,
        maxCalls: parseResult.data.maxCalls ?? 10,
        currentRoot: parseResult.data.currentRoot,
        preferredPath: parseResult.data.preferredPath,
      })
      .then((res) => {
        if ((res as { error?: string }).error) {
          console.error(
            '[discover] background run error',
            (res as { error: string }).error
          )
        } else {
          console.log('[discover] background run completed')
        }
      })
      .catch((err) => {
        console.error('[discover] background run threw', err)
      })
  } catch {
    // If scheduling itself throws synchronously, report error
    return c.json({ error: 'Failed to start discovery' }, 500)
  }
  return c.json({ status: 'queued', sessionId: parseResult.data.phone }, 202)
})

// GET /tree/:sessionId (sessionId is phone number)
app.get('/tree/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const idOk = z.string().min(1).safeParse(sessionId)
  if (!idOk.success) {
    return c.json({ error: 'Invalid sessionId' }, 400)
  }
  const session = await loadSession(sessionId)
  if (!session || !session.lastRoot) {
    return c.json({ error: 'Not found' }, 404)
  }
  // derive visited & pending path sets (mirrors logic in DiscoverService)
  const visitedPaths: string[][] = []
  const pendingPaths: string[][] = []
  type AnyNode = {
    id: string
    options: { digit: string; targetNodeId: string | null }[]
    children: AnyNode[]
  }
  const stack: { node: AnyNode; path: string[] }[] = [
    { node: session.lastRoot as unknown as AnyNode, path: [] },
  ]
  while (stack.length) {
    const { node, path } = stack.pop() as { node: AnyNode; path: string[] }
    const options = Array.isArray(node?.options) ? node.options : []
    const children = Array.isArray(node?.children) ? node.children : []
    for (const opt of options) {
      const nextPath = [...path, String(opt.digit)]
      if (opt.targetNodeId) {
        visitedPaths.push(nextPath)
        const child = children.find((c) => c.id === opt.targetNodeId)
        if (child) stack.push({ node: child, path: nextPath })
      } else {
        pendingPaths.push(nextPath)
      }
    }
  }
  return c.json({
    sessionId,
    root: session.lastRoot,
    totalCost: session.totalCost ?? 0,
    callsCount: session.calls?.length ?? 0,
    visitedPaths,
    pendingPaths,
    updatedAt: session.updatedAt,
  })
})

// POST /refine/:nodeId
app.post('/refine/:nodeId', async (c) => {
  const nodeId = c.req.param('nodeId')
  const body = await c.req.json().catch(() => ({}))
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'Invalid input' }, 400)
  }
  const session = await loadSession(parsed.data.sessionId)
  if (!session || !session.lastRoot) {
    return c.json({ error: 'Not found' }, 404)
  }
  // For now, refinement queues a preferred path exploration starting from this node
  const pathDigits = nodeId.split('-').filter(Boolean)
  const service = new DiscoverService()
  const result = await service.run({
    phone: parsed.data.sessionId,
    minCalls: 1,
    maxCalls: 3,
    currentRoot: session.lastRoot,
    preferredPath: pathDigits,
  })
  return c.json(result)
})

// GET /call-history/:sessionId
app.get('/call-history/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const idOk = z.string().min(1).safeParse(sessionId)
  if (!idOk.success) {
    return c.json({ error: 'Invalid sessionId' }, 400)
  }
  const session = await loadSession(sessionId)
  if (!session) return c.json({ error: 'Not found' }, 404)
  return c.json({
    sessionId,
    calls: session.calls,
    totalCost: session.totalCost ?? 0,
  })
})

const port = 4000
console.log(`Server is running on http://localhost:${port}`)

serve({
  fetch: app.fetch,
  port,
})
