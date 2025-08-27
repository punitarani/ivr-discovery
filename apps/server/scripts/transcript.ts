import { getCallTranscript } from '@/bland'

const call_id = 'e283cfa8-3489-4190-b103-6c46d7449d65'

const transcript = await getCallTranscript(call_id)
console.dir(transcript, { depth: null })
