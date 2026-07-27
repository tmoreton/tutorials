// app/MyAgent/main.ts

import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { Agent } from '@strands-agents/sdk';
import { loadModel } from './model/load.js';

const agent = new Agent({
  model: await loadModel(),
  systemPrompt: 'You are a helpful AI assistant. Be concise and direct.',
});

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    async *process(payload: any) {
      for await (const event of agent.stream(payload.prompt ?? '')) {
        // The stream emits several event types; we only want the text tokens.
        if (
          event.type === 'modelStreamUpdateEvent' &&
          event.event?.type === 'modelContentBlockDeltaEvent' &&
          event.event.delta?.type === 'textDelta'
        ) {
          yield { data: event.event.delta.text };
        }
      }
    },
  },
});

app.run({ port: parseInt(process.env.PORT ?? '8080') });
