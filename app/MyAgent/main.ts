import { Agent } from '@strands-agents/sdk'

const agent = new Agent({
  systemPrompt: 'You are a helpful AI assistant. Be concise and direct.',
})

export default async function handler(payload: { prompt?: string }) {
  const userMessage = payload.prompt ?? 'Hello!'
  const result = await agent.invoke(userMessage)
  return { result: result.lastMessage }
}
