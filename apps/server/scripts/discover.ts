import '@/env'
import { DiscoverService } from '@/discover'
import { renderIvrTreeAsText } from '@/tree'

const phone = process.argv[2] || '+18007521547'
const minCalls = Number.parseInt(process.argv[3] || '2', 10)
const maxCalls = Number.parseInt(process.argv[4] || '10', 10)

const service = new DiscoverService()
const result = await service.run({ phone, minCalls, maxCalls })

if ('error' in result) {
  console.error(`Discover error: ${result.error}`)
  process.exit(1)
}

const treeText = renderIvrTreeAsText(result.root)
console.log(treeText)
