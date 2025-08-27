'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { trpc } from '@/lib/trpc'

export default function Home() {
  const hello = trpc.hello.useQuery({ name: 'World' })
  const users = trpc.getUsers.useQuery()

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold mb-8">Welcome to IVR App</h1>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>tRPC Hello</CardTitle>
            <CardDescription>Testing tRPC connection</CardDescription>
          </CardHeader>
          <CardContent>
            {hello.data ? (
              <p className="text-lg">{hello.data.greeting}</p>
            ) : (
              <p>Loading...</p>
            )}
            <Button
              onClick={() => hello.refetch()}
              className="mt-4"
              disabled={hello.isLoading}
            >
              Refresh
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>Sample user data from API</CardDescription>
          </CardHeader>
          <CardContent>
            {users.data ? (
              <ul className="space-y-2">
                {users.data.map((user) => (
                  <li
                    key={user.id}
                    className="flex items-center justify-between p-2 bg-muted rounded"
                  >
                    <span>{user.name}</span>
                    <span className="text-sm text-muted-foreground">
                      ID: {user.id}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Loading users...</p>
            )}
            <Button
              onClick={() => users.refetch()}
              className="mt-4"
              variant="outline"
              disabled={users.isLoading}
            >
              Refresh
            </Button>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
