---
title: "Build Your Own ChatGPT in 30 Minutes"
published: false
description: "One TypeScript file, three CLI commands, and an HTML page. That's the whole thing."
tags: ai, aws, typescript, tutorial
cover_image: 
---

Here's the pitch. You've used ChatGPT. You've probably used Claude, Gemini, maybe a few others. And at some point, the thought crossed your mind:

> What would it take to build my own?

Not a wrapper. Not a "paste your API key into someone else's UI" tutorial. A conversational AI you own. The model, the infrastructure, the deployment, the cost.

Turns out, it's about 30 minutes of work. One TypeScript file, a few CLI commands, and a single HTML page for the frontend. This post walks you through all of it.

By the end, you'll have a working chat interface backed by a model on Amazon Bedrock (we'll use the ultra-cheap Amazon Nova Micro), deployed to a hosted endpoint, costing fractions of a cent per conversation. And it's the foundation for everything that comes next: memory, authentication, document Q&A, guardrails. But today we keep it dead simple.

**What you'll need:** An AWS account, Node.js 22+, and npm. That's it.

Let's go.

---

## The mental model: an agent is a model + a prompt

Before we touch code, here's what we're building:

```
Browser (HTML + JS) → AgentCore Runtime (hosted endpoint) → Strands Agent → Bedrock (Nova Micro)
```

You write a Strands agent in TypeScript. The AgentCore CLI deploys it as a hosted endpoint. Your frontend sends messages to that endpoint. Done.

No Lambda functions. No API Gateway. No Docker. Just TypeScript and a couple CLI commands.

---

## Step 1: Set up your environment

The fastest path: the [Agent Toolkit for AWS](https://github.com/aws/agent-toolkit-for-aws) handles credentials, CLI tools, and login in one shot:

```bash
aws configure agent-toolkit
```

That's it. Move to the next step.

**Or, do it manually:**

```bash
# 1. Install the AWS CLI (if you don't have it)
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# 2. Configure your AWS credentials
aws configure
# (enter your Access Key ID, Secret Access Key, region, output format)

# 3. Verify it works
aws sts get-caller-identity
```

Either way, once your credentials are set, install the AgentCore CLI:

```bash
npm install -g @aws/agentcore
```

That's your toolchain ready.

---

## Step 2: Scaffold the project

One command scaffolds the entire project:

```bash
agentcore create \
  --name MyAgent \
  --framework Strands \
  --language TypeScript \
  --protocol HTTP \
  --model-provider Bedrock \
  --memory none
```

What each flag does:
- `--name` – The project name (alphanumeric, starts with a letter, max 36 characters).
- `--framework` – The agent framework. Supported values: `Strands`, `LangChain_LangGraph`, `GoogleADK`, `OpenAIAgents`.
- `--language` – The language for generated code. Supported values: `TypeScript`, `Python`.
- `--protocol` – The protocol mode. Supported values: `HTTP` (default), `MCP`, `A2A`.
- `--model-provider` – The model provider. Supported values: `Bedrock`, `Anthropic`, `OpenAI`, `Gemini`.
- `--memory` – Memory configuration. Supported values: `none`, `shortTerm`, `longAndShortTerm`.

You get this structure:

```
MyAgent/
├── agentcore/
│   ├── agentcore.json        # Project config
│   ├── aws-targets.json      # Account + region
│   └── cdk/                  # Deployment infra (you won't touch this)
└── app/
    └── MyAgent/
        ├── main.ts           # Your agent ← this is the file that matters
        ├── model/load.ts     # Which Bedrock model to use
        ├── package.json      # Dependencies
        └── tsconfig.json
```

(The scaffold also drops in an example tool and an MCP client — nice for later, but we'll strip them out to keep this post to a pure chat agent.)

---

## Step 3: Write the agent

The scaffold gives you a working agent out of the box — a small server built on `BedrockAgentCoreApp` that streams tokens back as they generate. Open `app/MyAgent/main.ts` and trim it down to a pure chat agent:

```typescript
import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { Agent } from '@strands-agents/sdk';
import { loadModel } from './model/load.js';

const SYSTEM_PROMPT = 'You are a helpful AI assistant. Be concise and direct.';

// One Agent per session so each conversation keeps its own history.
const agentCache = new Map<string, Agent>();

async function getOrCreateAgent(sessionId: string): Promise<Agent> {
  let agent = agentCache.get(sessionId);
  if (!agent) {
    agent = new Agent({ model: await loadModel(), systemPrompt: SYSTEM_PROMPT });
    agentCache.set(sessionId, agent);
  }
  return agent;
}

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    async *process(payload: any, context: any) {
      const agent = await getOrCreateAgent(context?.sessionId ?? 'default-session');
      for await (const event of agent.stream(payload.prompt ?? '')) {
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
```

Let's break it down:

- `BedrockAgentCoreApp` is the server harness. It exposes the `/invocations` and `/ping` endpoints the runtime expects, so your code is just the handler.
- `new Agent()` creates a Strands agent pointed at a Bedrock model (see `model/load.ts`). This demo uses **Amazon Nova Micro** — Bedrock's cheapest text model, so a conversation costs a fraction of a cent. Swap the model id for Claude Sonnet when you want more reasoning power. No API keys, no client setup; it uses your AWS credentials directly.
- `agent.stream(message)` runs the agent loop and yields events as tokens generate. We filter for text deltas and `yield` each one — that's what makes the frontend feel alive instead of waiting for the full answer.
- The session cache means "what did I just ask you?" works — each session id keeps its own conversation history.

(The full version in the repo adds an LRU bound on the cache and rolls back history if a stream fails mid-turn — worth keeping, but the above is the idea.)

---

## Step 4: Test locally

Before deploying anywhere, run it on your machine:

```bash
agentcore dev
```

This installs dependencies, compiles TypeScript, starts a local server on port 8080, and opens a browser-based inspector where you can chat with your agent.

In a separate terminal:

```bash
agentcore dev "What is the capital of France?"
```

You should see the response stream back. If that works, your agent runs.

> **Heads up:** First run takes a moment while it installs packages and compiles. After that, starts are near-instant with hot reload.

---

## Step 5: Deploy to AWS

One command:

```bash
agentcore deploy
```

The CLI:
1. Compiles TypeScript and packages it as a CodeZip archive
2. Uses CDK to synthesize and deploy CloudFormation resources
3. Creates IAM roles and an AgentCore Runtime endpoint
4. Configures CloudWatch logging

> **Heads up:** First deploy takes a few minutes while CDK bootstraps. Subsequent deploys are faster. Use `agentcore deploy --dry-run` to preview changes without deploying.

Test your deployed agent:

```bash
agentcore invoke "Hello! What can you help me with?"
```

Stream the response in real time:

```bash
agentcore invoke "Tell me a joke" --stream
```

If you see a response, your agent is live on AWS.

---

## Step 6: The frontend

One HTML file. No build step. No npm install. The core of it is one function:

```javascript
// The only part that matters — call your agent and stream the response
async function send(text, onToken) {
  const res = await fetch("http://localhost:8080/invocations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream", // required — the agent streams SSE
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId, // keeps chat history
    },
    body: JSON.stringify({ prompt: text }),
  });

  // The response is a Server-Sent Events stream: `data: "token"` frames.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop(); // keep any partial frame for the next read
    for (const evt of events) {
      const line = evt.split("\n").find((l) => l.startsWith("data:"));
      if (line) onToken(JSON.parse(line.slice(5).trim()));
    }
  }
}
```

Two things bit me here, so they're worth calling out: the server **requires** the `Accept: text/event-stream` header (you get a JSON error without it), and the response is not a single JSON object — it's an SSE stream of JSON-encoded token strings. In exchange, you get ChatGPT-style token-by-token rendering for free. The rest is just HTML and CSS to make it look like a chat window.

The full `index.html` (dark theme, chat bubbles, enter-to-send) is in the repo. Clone it, run `agentcore dev`, open the file in your browser. That's your ChatGPT.

```bash
# Grab the frontend
git clone https://github.com/tmoreton/tutorials
open tutorials/index.html
```

---

## Step 7: Deploy the frontend with GitHub Pages

Push your project to GitHub:

```bash
git init && git add . && git commit -m "initial commit"
gh repo create my-ai-chat --public --push
```

Enable GitHub Pages in your repo settings (Settings > Pages > Source: deploy from branch `main`, folder `/ (root)`). Or do it from the CLI:

```bash
gh api repos/YOUR_USERNAME/my-ai-chat/pages -X POST -f source.branch=main -f source.path=/
```

Your app is live at:

```
https://YOUR_USERNAME.github.io/my-ai-chat
```

HTTPS, free, auto-deploys on push. No AWS service needed for the frontend.

> **Heads up:** The deployed AgentCore endpoint requires AWS-signed (SigV4) requests, so a browser can't call it directly — that's why the frontend calls `localhost:8080` and needs `agentcore dev` running. The repo also includes the fix: a small streaming Lambda proxy behind CloudFront (`proxy/`) that signs requests to the runtime, so the hosted frontend talks to the production agent. Post 2 walks through building it — including the CloudFront OAC wrinkles (the `x-amz-content-sha256` header, the double invoke permission) that cost me an afternoon.

---

## The honest gotchas list

These cost me time so they don't cost you:

1. **"Access denied" from Bedrock.** Your IAM identity needs `bedrock:InvokeModel` permission. Personal accounts with admin access are fine. Org accounts with locked-down roles need policy updates.

2. **First `agentcore deploy` takes 3-5 minutes.** CDK bootstraps your account on the first run. Subsequent deploys are faster.

3. **The response is a stream, not JSON.** The agent server speaks Server-Sent Events and *requires* an `Accept: text/event-stream` header. If your frontend does `res.json()` expecting `{result: "..."}`, you'll get an error object instead. Read the stream (see Step 6).

4. **The deployed endpoint isn't browser-callable.** It requires SigV4-signed requests. Don't try to sign from client-side JS — you'd be shipping AWS credentials in page source. Put a proxy in front (Post 2).

5. **TypeScript compilation errors.** Make sure `"type": "module"` is set in package.json and your tsconfig is correct. Run `npm run build` locally to catch errors before deploying.

6. **Cold starts.** The runtime scales down when idle. First request after inactivity takes extra seconds.


---

## Where to take it next

Right now this is a starting point. It works locally, it's deployed, it's cheap. But the conversation resets every message, there's no auth, and the deployed endpoint isn't browser-accessible yet.

The next posts in this series fix that:

- **Post 2: Add memory + a public endpoint** — AgentCore Memory for conversation persistence. A streaming Lambda proxy behind CloudFront for a browser-callable URL.
- **Post 3: Add authentication** — Cognito so each user gets their own sessions.
- **Post 4: Chat with your documents** — RAG with Bedrock Knowledge Bases.
- **Post 5: Add guardrails** — Content filtering, PII redaction, topic blocking.
- **Post 6: Give it tools** — Web search, code execution, API calls.
- **Post 7: Go to production** — Custom domain, CI/CD, monitoring, cost controls.

Each post builds on this one. Same agent at the core, progressively more capable.

---

## The full picture

| Layer | What | How |
|-------|------|-----|
| Model | Amazon Nova Micro (swappable) | Amazon Bedrock |
| Agent | ~40 lines of TypeScript | Strands Agents SDK + AgentCore app server |
| Backend hosting | `agentcore deploy` | AgentCore Runtime |
| Frontend hosting | Push to GitHub | GitHub Pages |

All deployed from your terminal. Zero console visits.

---

## Source

[The complete code for this tutorial is on GitHub →](https://github.com/tmoreton/tutorials)

---

*If this was useful, follow along. The next post drops next week.*
