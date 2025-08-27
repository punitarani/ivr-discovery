import { initTRPC } from '@trpc/server'
import { z } from 'zod'

const t = initTRPC.create()

const UserSchema = z.object({
  id: z.number(),
  name: z.string().min(1),
  email: z.string().email().optional(),
})

const CreateUserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email format').optional(),
})

type User = z.infer<typeof UserSchema>

const users: User[] = [
  { id: 1, name: 'Alice', email: 'alice@example.com' },
  { id: 2, name: 'Bob', email: 'bob@example.com' },
  { id: 3, name: 'Charlie' },
]

export const appRouter = t.router({
  hello: t.procedure
    .input(z.object({ name: z.string().min(1, 'Name cannot be empty') }))
    .query(({ input }) => {
      return {
        greeting: `Hello ${input.name}!`,
        timestamp: new Date().toISOString(),
      }
    }),

  getUsers: t.procedure.query(() => {
    return users.map((user) => UserSchema.parse(user))
  }),

  createUser: t.procedure.input(CreateUserSchema).mutation(({ input }) => {
    const newUser: User = {
      id: Math.max(...users.map((u) => u.id)) + 1,
      ...input,
    }

    const validatedUser = UserSchema.parse(newUser)
    users.push(validatedUser)

    return validatedUser
  }),

  getUserById: t.procedure
    .input(z.object({ id: z.number().positive('ID must be positive') }))
    .query(({ input }) => {
      const user = users.find((u) => u.id === input.id)
      if (!user) {
        throw new Error('User not found')
      }
      return UserSchema.parse(user)
    }),
})

export type AppRouter = typeof appRouter
