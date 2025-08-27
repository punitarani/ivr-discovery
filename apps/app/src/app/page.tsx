'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { postDiscover } from '@/lib/api'

const ONE_PHONE_NUMBER = '+15555555555'

function normalizePhone(input: string): string | null {
  const t = String(input || '').trim()
  if (t.startsWith('+')) return t
  const digits = (t.match(/\d+/g) || []).join('')
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  return null
}

export default function Home() {
  const phoneId = useId()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [phone, setPhone] = useState(ONE_PHONE_NUMBER)

  const onStart = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const normalized = normalizePhone(phone)
      if (!normalized) {
        throw new Error(
          'Invalid phone number. Use E.164 like +1XXXXXXXXXX or US 10-digit.'
        )
      }
      await postDiscover(normalized)
      router.push(`/${encodeURIComponent(normalized)}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Discover failed'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [phone, router])

  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-semibold mb-6">IVR Discovery</h1>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Start Discovery</CardTitle>
          <CardDescription>
            Enter the phone number and start. Only one number is supported.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Label htmlFor={phoneId}>Phone Number</Label>
              <Input
                id={phoneId}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1XXXXXXXXXX"
              />
            </div>
            <Button onClick={onStart} disabled={loading}>
              {loading ? 'Starting…' : 'Start'}
            </Button>
          </div>
          {error ? <p className="text-sm text-red-600 mt-2">{error}</p> : null}
        </CardContent>
      </Card>
    </main>
  )
}
