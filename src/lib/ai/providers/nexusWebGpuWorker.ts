import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()
const workerScope = self as unknown as { onmessage: ((event: MessageEvent) => void) | null }

workerScope.onmessage = event => handler.onmessage(event)
