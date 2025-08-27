import { z } from 'zod'
import { env } from '@/env'

function normalizePhoneToE164(input: string): string | null {
  const trimmed = String(input || '').trim()
  if (trimmed.startsWith('+')) {
    return trimmed
  }
  const digitsOnly = (trimmed.match(/\d+/g) || []).join('')
  if (digitsOnly.length === 11 && digitsOnly.startsWith('1')) {
    return `+${digitsOnly}`
  }
  if (digitsOnly.length === 10) {
    return `+1${digitsOnly}`
  }
  return null
}

export const MakeCallRequestSchema = z.object({
  phone_number: z.string().min(1),
  task: z.string().min(1),
  wait_for_greeting: z.boolean().default(true),
  ivr_mode: z.boolean().default(true),
  record: z.boolean().default(true),
  voicemail_detect: z.boolean().default(true),
  max_duration: z.number().int().positive().default(120),
})
export type MakeCallRequest = z.infer<typeof MakeCallRequestSchema>

export const MakeCallResponseSchema = z.object({
  status: z.enum(['success', 'error']),
  call_id: z.string().optional(),
  error_message: z.string().optional(),
})
export type MakeCallResponse = z.infer<typeof MakeCallResponseSchema>

/**
 * Makes a call to a phone number with a given task using Bland AI
 * @param phoneNumber - Phone number in E.164 format (e.g., +1234567890)
 * @param task - The task/prompt for the AI agent
 * @returns Promise with call response containing call_id if successful
 */
export async function makeCall(
  phoneNumber: string,
  task: string
): Promise<MakeCallResponse> {
  try {
    const normalized = normalizePhoneToE164(phoneNumber)
    if (!normalized) {
      return {
        status: 'error',
        error_message:
          'Invalid phone number. Use E.164 format like +1XXXXXXXXXX (US 10-digit numbers are accepted).',
      }
    }

    // Validate input
    const validatedInput = MakeCallRequestSchema.parse({
      phone_number: normalized,
      task,
      wait_for_greeting: true,
      ivr_mode: true,
      record: true,
      voicemail_detect: true,
      max_duration: 300,
    })

    console.log('[call] placing call', {
      phone_number: validatedInput.phone_number,
      wait_for_greeting: validatedInput.wait_for_greeting,
      ivr_mode: validatedInput.ivr_mode,
      record: validatedInput.record,
      voicemail_detect: validatedInput.voicemail_detect,
      max_duration: validatedInput.max_duration,
    })

    const authHeader = env.BLAND_API_KEY.startsWith('Bearer ')
      ? env.BLAND_API_KEY
      : `Bearer ${env.BLAND_API_KEY}`

    const response = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validatedInput),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error('[call] HTTP error', response.status, errorText)
      return {
        status: 'error',
        error_message: `HTTP ${response.status}: ${errorText}`,
      }
    }

    const data = await response.json()
    const parsed = MakeCallResponseSchema.parse(data)
    console.log('[call] queued', parsed)
    return parsed
  } catch (error) {
    console.error('[call] makeCall exception', error)
    return {
      status: 'error',
      error_message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

export const CallDetailsSchema = z
  .object({
    call_id: z.string(),
    status: z.string().nullable().optional(),
    answered_by: z.string().nullable().optional(),
    price: z.number().nullable().optional(),
  })
  .loose()

export type CallDetails = z.infer<typeof CallDetailsSchema>

export async function getCallDetails(
  callId: string
): Promise<CallDetails | { error: string }> {
  try {
    const res = await fetch(`https://api.bland.ai/v1/calls/${callId}`, {
      headers: { Authorization: env.BLAND_API_KEY },
    })
    if (!res.ok) {
      return { error: `HTTP ${res.status}: ${await res.text()}` }
    }
    const data = await res.json()
    return CallDetailsSchema.parse(data)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unknown error' }
  }
}

export async function pollCallUntilDone(
  callId: string,
  {
    intervalMs = 5000,
    timeoutMs = 180000,
  }: { intervalMs?: number; timeoutMs?: number }
): Promise<CallDetails | { error: string; timeout?: boolean }> {
  const start = Date.now()
  let wait = Math.max(1000, intervalMs)
  while (Date.now() - start < timeoutMs) {
    const details = await getCallDetails(callId)
    if ('error' in details) {
      // basic backoff on API errors (rate limits)
      wait = Math.min(wait * 2, 20000)
      console.warn('[poll] error', { callId, wait, error: details.error })
    } else {
      const status = String(details.status || '').toLowerCase()
      if (
        status === 'completed' ||
        status === 'failed' ||
        status === 'canceled'
      ) {
        console.log('[poll] terminal', { callId, status: details.status })
        return details
      }
      // reset backoff on successful poll
      wait = Math.max(1000, intervalMs)
      console.log('[poll] progress', {
        callId,
        status: details.status,
        nextWait: wait,
      })
    }
    await new Promise((r) => setTimeout(r, wait))
  }
  console.error('[poll] timeout', { callId })
  return { error: 'Polling timed out', timeout: true }
}
