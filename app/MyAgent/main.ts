import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { Agent } from '@strands-agents/sdk';
import { loadModel } from './model/load.js';

const SYSTEM_PROMPT = 'You are a helpful AI assistant. Be concise and direct.';

const AGENT_CACHE_LIMIT = 128;

// Reuses one Agent per sessionId so each session keeps its own in-process
// conversation history (best-effort; resets on cold start). A Map preserves
// insertion order, so it doubles as an LRU bounded to 128 sessions. On
// AgentCore Runtime each microVM serves a single session, so this holds one
// entry. For durable history, attach memory.
const agentCache = new Map<string, Agent>();

async function getOrCreateAgent(sessionId: string): Promise<Agent> {
  const existing = agentCache.get(sessionId);
  if (existing) {
    agentCache.delete(sessionId);
    agentCache.set(sessionId, existing);
    return existing;
  }
  if (agentCache.size >= AGENT_CACHE_LIMIT) {
    const oldest = agentCache.keys().next().value;
    if (oldest !== undefined) agentCache.delete(oldest);
  }
  const model = await loadModel();
  const agent = new Agent({ model, systemPrompt: SYSTEM_PROMPT });
  agentCache.set(sessionId, agent);
  return agent;
}

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    async *process(payload: any, context: any) {
      const sessionId = context?.sessionId ?? 'default-session';
      const agent = await getOrCreateAgent(sessionId);

      // Snapshot history before streaming so a failed turn can be rolled back,
      // keeping the cached session reusable (providers require strict role
      // alternation, so a lingering half-turn would break the next request).
      const snapshot = agent.takeSnapshot({ include: ['messages'] });
      try {
        for await (const event of agent.stream(payload.prompt ?? '')) {
          if (
            event.type === 'modelStreamUpdateEvent' &&
            event.event?.type === 'modelContentBlockDeltaEvent' &&
            event.event.delta?.type === 'textDelta'
          ) {
            yield { data: event.event.delta.text };
          }
        }
      } catch (error) {
        agent.loadSnapshot(snapshot);
        throw error;
      }
    },
  },
});

app.run({ port: parseInt(process.env.PORT ?? '8080') });
