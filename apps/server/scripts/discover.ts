import '@/env'
import { DiscoverService } from '@/discover'
import { renderIvrTreeAsText } from '@/tree'

const callId = process.argv[2] || 'e283cfa8-3489-4190-b103-6c46d7449d65'

const service = new DiscoverService()
const result = await service.run({ callId })

if ('error' in result) {
  console.error(`Discover error: ${result.error}`)
  process.exit(1)
}

const treeText = renderIvrTreeAsText(result.root)
console.log(treeText)
