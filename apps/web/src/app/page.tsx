'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export default function Home() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold mb-8">Welcome to IVR Discovery App</h1>

      <div className="grid gap-6 md:grid-cols-1">
        <Card>
          <CardHeader>
            <CardTitle>IVR Discovery</CardTitle>
            <CardDescription>
              Discover and map Interactive Voice Response (IVR) menu systems
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-lg mb-4">
              Start exploring phone system menus to create an interactive tree
              of options and navigation paths.
            </p>
            <Button className="mt-4">Start Discovery</Button>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
