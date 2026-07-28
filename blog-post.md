---
title: "I Built a Rubber Duck That Roasts Your Code"
published: false
description: "Rubber-duck debugging, but the duck talks back — and it's Gordon Ramsay. One TypeScript file, a few CLI commands, and an HTML page."
tags: ai, aws, typescript, tutorial
cover_image: https://unducked.com/assets/hero.png
---

Every developer knows rubber-duck debugging: you explain your code to a rubber duck on your desk, and halfway through the explanation you spot the bug yourself. The duck just sits there. Silent. Judging.

I wanted a duck that judges *out loud*.

So I built **Unducked** — paste in your code, and a foul-mouthed rubber duck reviews it like Gordon Ramsay reviews a risotto. It roasts you. It calls your function RAW. And then, annoyingly, it finds the actual bug and hands you the fix.

It's genuinely useful — the roast is a real code review — and it's the kind of thing you screenshot and send to the group chat. Best of all, the whole thing is one TypeScript file, a few CLI commands, and a single HTML page. About 30 minutes of work.

Here's how to build your own.

---

## The mental model: an agent is a model + a prompt

The "AI" here isn't complicated. An agent is just a model with a personality bolted on via a system prompt. That's the entire trick — the model didn't change, the prompt did.

Here's the shape of what we're building:

```text
Browser (HTML + JS) → AgentCore Runtime (hosted endpoint) → Strands Agent → Bedrock (Amazon Nova Lite)
```

You write a Strands agent in TypeScript. The AgentCore CLI deploys it as a hosted endpoint on AWS. Your frontend sends code to that endpoint and streams the roast back.

No Lambda functions to hand-write. No API Gateway. No Docker. Just TypeScript and a couple of CLI commands.

---

## Step 1: Set up your environment

You'll need an AWS account, Node.js 22+, and npm.

**The fast path:** if you use a coding agent (Claude Code, Cursor, Kiro, Codex), the [Agent Toolkit for AWS](https://github.com/aws/agent-toolkit-for-aws) handles credentials and CLI tools in one shot — just ask it to set up AWS access.

**Or, manually:**

```bash
# Configure AWS credentials, then verify
aws configure
aws sts get-caller-identity

# Install the AgentCore CLI and the AWS CDK (AgentCore uses CDK to deploy)
npm install -g @aws/agentcore aws-cdk
```

That's your toolchain.

---

## Step 2: Scaffold the project

One command scaffolds everything:

```bash
agentcore create --name Unducked --no-agent
cd Unducked
agentcore add agent \
  --name Unducked \
  --type create \
  --build CodeZip \
  --language TypeScript \
  --framework Strands \
  --model-provider Bedrock \
  --memory none
```

You get this structure:

```text
Unducked/
├── agentcore/                # Config + CDK (you won't touch this)
└── app/Unducked/
    ├── main.ts               # The agent ← the file that matters
    ├── model/load.ts         # Which Bedrock model to use
    ├── package.json
    └── tsconfig.json
```

The scaffold drops in an example tool and an MCP client. Nice for later — we'll strip them out for a pure roasting duck.

---

## Step 3: Write the duck

This is where the personality lives. Open `app/Unducked/main.ts` and trim it to this:

```typescript
// app/Unducked/main.ts
import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { Agent } from '@strands-agents/sdk';
import { loadModel } from './model/load.js';

const SYSTEM_PROMPT = `You are Chef Duck — a foul-mouthed-but-brilliant rubber
duck that reviews code like Gordon Ramsay runs a kitchen.

- Open with a short, savage roast of the CODE (never the person). Kitchen
  metaphors encouraged: "this function is RAW", "it's so nested it's got its
  own zip code".
- Then ACTUALLY HELP. Every roast must name the concrete bug and give the fix.
  Useful first, funny second.
- If the code is genuinely good, be begrudgingly impressed. Don't invent bugs
  just to be mean.
- Keep it tight. PG-13 — spicy, not vile. Plain prose, no headings, a fenced
  code block for the fix.`;

const agent = new Agent({ model: await loadModel(), systemPrompt: SYSTEM_PROMPT });

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    async *process(payload: any) {
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

Three pieces:

1. **The system prompt** *is* the product. Everything that makes it "Chef Duck" is those few sentences.
2. **`BedrockAgentCoreApp`** wires the agent to the HTTP endpoints the runtime expects — you just write the handler.
3. **Stream the roast back** by iterating over `agent.stream()` and yielding each text delta.

> **Gotcha that cost me time:** the stream emits several event types, and you can only reach `event.event` after narrowing on `event.type` first. The three-part `if` above is what actually compiles — a bare `event.event?.delta?.type` throws a TypeScript error. Copy it exactly.

`loadModel()` points at **Amazon Nova Lite** — ~$0.06/$0.24 per million tokens on Bedrock, so roasts cost a fraction of a cent. The trick to making a cheap model behave is in the system prompt: cheap models love to "help" by suggesting type checks and validation on code that already works, so the prompt explicitly forbids that and tells the duck to just concede when the code is fine. Swap the model ID in `model/load.ts` for Claude Haiku or Sonnet if you want more polish.

---

## Step 4: Test locally

```bash
agentcore dev
```

In another terminal:

```bash
agentcore dev "function last(arr) { return arr[arr.length]; }"
```

You'll get an off-by-one roast streamed back, live. If that works, your duck is alive.

---

## Step 5: Deploy to AWS

```bash
agentcore deploy
```

The CLI compiles your TypeScript, packages it, uses CDK to stand up the IAM roles and an AgentCore Runtime endpoint, and wires up CloudWatch logging. First deploy takes a few minutes while CDK bootstraps; after that it's fast.

```bash
agentcore invoke "def add(a, b): return a - b" --stream
```

If the duck tells you your `add` function is a liar, you're live on AWS.

---

## Step 6: The frontend

One HTML file, no build step. During local dev it talks to `agentcore dev` on port 8080. The core is one function — send code, stream the roast:

```javascript
async function roast(code, onToken) {
  const res = await fetch("http://localhost:8080/invocations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "text/event-stream", // required — the agent streams SSE
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
    },
    body: JSON.stringify({ prompt: code }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop(); // keep any partial frame
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data:"));
      if (line) onToken(JSON.parse(line.slice(5).trim()));
    }
  }
}
```

Two things worth calling out. The server **requires** the `Accept: text/event-stream` header — without it you get a JSON error, not a stream. And the response isn't a single JSON blob; it's a Server-Sent Events stream of token strings. In exchange you get roasts that type out live, like the duck is thinking. The rest is HTML and CSS — a monospace paste box, a "Roast it" button, and a little ASCII duck up top.

Since the roast comes back as Markdown (bold, code blocks), render it into HTML — but **escape everything before formatting**, since you're injecting the model's output into the page. A dozen lines of regex handles bold, code fences, and headings safely.

```bash
git clone https://github.com/tmoreton/tutorials
open tutorials/index.html
```

---

## Step 7: Put it on the internet

Push to GitHub, then **Settings → Pages → Deploy from branch `main`, folder `/`**. A minute later your duck is live at `https://unducked.com` — HTTPS, free, auto-deploying on every push. Point a custom domain at it (say, `unducked.com`) and you've got a product.

There's one wrinkle. The deployed AgentCore endpoint requires AWS SigV4-signed requests — a browser can't call it directly, and you must **never** sign from client-side JS (that ships your AWS credentials in page source). The repo includes a small streaming Lambda proxy behind CloudFront that signs on the browser's behalf. Deploy it, point the frontend's endpoint at the CloudFront URL, and the hosted duck talks to the deployed agent.

The CloudFront-over-Lambda setup has two gotchas that cost me an afternoon: POST bodies need an `x-amz-content-sha256` header, and CloudFront needs *both* `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction` permissions. The repo's `DEPLOYMENT.md` walks through both so you don't repeat them.

---

## Watch the bill

The endpoint is public and unauthenticated — anyone with the URL can spend your Bedrock tokens. Nova Lite is cheap (a fraction of a cent per roast), but set a **reserved-concurrency cap on the Lambda** (I use 2) and an AWS budget alarm so a viral moment doesn't become a surprise invoice.

---

## The full picture

| Layer | What | How |
|-------|------|-----|
| Personality | A system prompt | The whole product, really |
| Model | Amazon Nova Lite | Amazon Bedrock |
| Agent | ~30 lines of TypeScript | Strands Agents SDK + AgentCore |
| Backend hosting | `agentcore deploy` | AgentCore Runtime |
| Public endpoint | Streaming Lambda + CloudFront | Signs requests for the browser |
| Frontend hosting | Push to GitHub | GitHub Pages |

The lesson underneath the jokes: a capable model plus a sharp system prompt is a shippable product. Change the prompt and Chef Duck becomes a patient mentor, a passive-aggressive senior dev, or a security auditor. Same 30 minutes, same stack.

---

## Source

[The complete code is on GitHub →](https://github.com/tmoreton/tutorials)

Go roast some code. Your duck is disappointed in you already.
