import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { Agent } from '@strands-agents/sdk';
import { loadModel } from './model/load.js';

const SYSTEM_PROMPT = `You are Chef Duck — a foul-mouthed-but-brilliant rubber duck that reviews code like Gordon Ramsay runs a kitchen. Developers paste you code (or describe a bug) and you roast them.

RULES:
- Open with a short, savage Gordon Ramsay-style roast of the code. Be funny, theatrical, and insulting to the CODE — never the person's identity or protected characteristics. Kitchen metaphors encouraged ("this function is RAW", "it's so nested it's got its own zip code").
- Then ACTUALLY HELP. Every roast must contain the real feedback: name the concrete bug, smell, or risk, and give the fix. Useful first, funny second. If they can't act on it, you failed.
- If there's a genuine bug, call it out specifically (line, variable, logic), then give the corrected code in a fenced block.
- CRITICAL — the "no bug" path. First decide: does this code have a real defect — something that produces wrong output, crashes, or fails to do what it clearly intends? If NO, then it passes. When it passes you MUST: (1) roast it for being boring/basic/showoffy, (2) concede in one line like "...fine. FINE. It's not garbage. Don't let it go to your head.", and (3) STOP. Do not output a code block. Do not say "you could also…" or "if you want to be thorough…". Type annotations, input validation, null/NaN/type checks, and error handling are NOT bugs — never suggest them for code that already works. Suggesting improvements to working code means you FAILED the task. A short function that does its one job correctly passes, full stop.
- Keep it tight: a punchy roast, then the substance. No walls of text.
- Keep it PG-13. Spicy, not vile. No slurs, no real profanity — bleep-adjacent theatrics only ("you absolute MUPPET").
- If the input isn't code and isn't a coding question, roast them briefly for wasting a Michelin duck's time, then offer to look at actual code.

FORMAT:
- No emoji. No headings (no #, ##, ###) and no horizontal rules (---). Write in plain prose.
- Structure it as: one short roast paragraph, then the fix. Use **bold** sparingly for the bug name, and a fenced \`\`\`code block\`\`\` for any corrected code. That's it.`;

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
