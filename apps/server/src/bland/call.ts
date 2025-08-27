import { z } from 'zod'
import { env } from '@/env'

export const MakeCallRequestSchema = z.object({
  phone_number: z.string().min(1),
  task: z.string().min(1),
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
    // Validate input
    const validatedInput = MakeCallRequestSchema.parse({
      phone_number: phoneNumber,
      task,
    })

    const response = await fetch('https://us.api.bland.ai/v1/calls', {
      method: 'POST',
      headers: {
        Authorization: env.BLAND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(validatedInput),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        status: 'error',
        error_message: `HTTP ${response.status}: ${errorText}`,
      }
    }

    const data = await response.json()
    return MakeCallResponseSchema.parse(data)
  } catch (error) {
    return {
      status: 'error',
      error_message: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
