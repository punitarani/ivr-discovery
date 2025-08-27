import { serve } from '@hono/node-server'
import { trpcServer } from '@hono/trpc-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { z } from 'zod'
import { DiscoverInputSchema, RefineInputSchema } from './models'
import { appRouter } from './router'

const app = new Hono()

app.use(
  '*',
  cors({
    origin: ['http://localhost:3000'],
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'PATCH'],
  })
)

app.use(
  '/api/trpc/*',
  trpcServer({
    router: appRouter,
  })
)

app.get('/', (c) => c.text('Hono server is running!'))

// POST /discover
app.post('/discover', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const parseResult = DiscoverInputSchema.safeParse(body)
  if (!parseResult.success) {
    return c.json(
      { error: 'Invalid input', details: parseResult.error.flatten() },
      400
    )
  }
  // Intentionally not implemented yet
  return c.json({ message: 'Not Implemented' }, 501)
})

// GET /tree/:sessionId
app.get('/tree/:sessionId', (c) => {
  const sessionId = c.req.param('sessionId')
  const idOk = z.string().min(1).safeParse(sessionId)
  if (!idOk.success) {
    return c.json({ error: 'Invalid sessionId' }, 400)
  }
  // Intentionally not implemented yet
  return c.json({ message: 'Not Implemented' }, 501)
})

// POST /refine/:nodeId
app.post('/refine/:nodeId', async (c) => {
  const nodeId = c.req.param('nodeId')
  const idOk = z.string().min(1).safeParse(nodeId)
  if (!idOk.success) {
    return c.json({ error: 'Invalid nodeId' }, 400)
  }
  // Optional JSON body could be validated by RefineInputSchema if needed
  const body = await c.req.json().catch(() => ({}))
  const parseResult = RefineInputSchema.partial().safeParse(body)
  if (!parseResult.success) {
    return c.json(
      { error: 'Invalid input', details: parseResult.error.flatten() },
      400
    )
  }
  // Intentionally not implemented yet
  return c.json({ message: 'Not Implemented' }, 501)
})

// GET /call-history/:sessionId
app.get('/call-history/:sessionId', (c) => {
  const sessionId = c.req.param('sessionId')
  const idOk = z.string().min(1).safeParse(sessionId)
  if (!idOk.success) {
    return c.json({ error: 'Invalid sessionId' }, 400)
  }
  // Intentionally not implemented yet
  return c.json({ message: 'Not Implemented' }, 501)
})

const port = 4000
console.log(`Server is running on http://localhost:${port}`)

serve({
  fetch: app.fetch,
  port,
})
