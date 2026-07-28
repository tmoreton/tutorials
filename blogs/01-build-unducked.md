---
title: "I Built a Rubber Duck That Roasts Your Code (and Deployed It to the Internet)"
series: "Building Unducked"
published: false
description: "Rubber-duck debugging, but the duck talks back — and it's Gordon Ramsay. One TypeScript file, a cheap model, and a public streaming endpoint on AWS. About an hour of work."
tags: ai, aws, typescript, tutorial
cover_image: https://unducked.com/assets/hero.png
---

Every developer knows rubber-duck debugging: you explain your code to a rubber duck on your desk, and halfway through the explanation you spot the bug yourself. The duck just sits there. Silent. Judging.

I wanted a duck that judges *out loud*.

So I built **[Unducked](https://unducked.com)** — paste in your code, and a foul-mouthed rubber duck reviews it like Gordon Ramsay reviews a risotto. It roasts you. It calls your function RAW. And then, annoyingly, it finds the actual bug and hands you the fix.

**Try it right now: [unducked.com](https://unducked.com/)** — there's a **dice button** that fires a random piece of broken code at the duck, so you can taste a roast without pasting anything.

It's genuinely useful — the roast is a real code review — and it's the kind of thing you screenshot and send to the group chat.

The whole thing is one TypeScript file, a cheap model, and a public streaming endpoint on AWS. Two things surprised me building it, and both are the interesting part of this post:

1. **The "AI" was the easy bit.** The duck's entire personality is one system prompt. The model never changed.
2. **Getting a *public* endpoint was the hard bit** — and not for the reason you'd think. More on that in Step 6.

Here's how to build your own.

---

## The mental model: an agent is a model + a prompt

The "AI" here isn't complicated. An agent is just a model with a personality bolted on via a system prompt. That's the entire trick.

Here's the shape of what we're building:

```text
Browser (unducked.com)
  → CloudFront + Lambda proxy   (public HTTPS; signs requests for the browser)
    → AgentCore Runtime          (hosted agent endpoint)
      → Strands Agent            (Chef Duck persona)
        → Bedrock (Amazon Nova Lite)
```

You write a Strands agent in TypeScript. The AgentCore CLI deploys it as a hosted endpoint on AWS. A tiny Lambda proxy makes that endpoint safely callable from a browser. No hand-written Lambda business logic, no API Gateway, no Docker — just TypeScript and a couple of CLI commands.

---

## Step 1: Set up your environment

You'll need an AWS account, Node.js 22+, and npm. You also need AWS credentials and a couple of CLI tools on your machine.

**The fast path (let an AI agent do it).** If you use a coding agent — Claude Code, Cursor, Kiro, Codex — hand it this and let it set everything up for you:

```text
Set up Agent Toolkit for AWS by following these instructions:
https://raw.githubusercontent.com/aws/agent-toolkit-for-aws/refs/heads/main/setup-instructions/setup.md
```

It configures credentials and installs the AWS tooling in one shot.

**Or, manually:**

```bash
# 1. Install the AWS CLI (macOS shown; see AWS docs for other platforms)
brew install awscli

# 2. Configure credentials, then verify they work
aws configure
aws sts get-caller-identity

# 3. Install the AgentCore CLI and the AWS CDK (AgentCore uses CDK to deploy)
npm install -g @aws/agentcore aws-cdk
```

One more thing: in the Bedrock console, enable model access for **Amazon Nova Lite**. That's your toolchain.

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

This is where the personality lives — and it's the whole product. Open `app/Unducked/main.ts`:

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
- The "no bug" path: if the code has no real defect, roast it for being
  boring, concede in one line ("...fine. It's not garbage."), and STOP.
  Type annotations, input validation, and null checks are NOT bugs — never
  suggest them for code that already works. Inventing improvements is failing.
- Keep it tight. PG-13 — spicy, not vile. Plain prose, no headings, a fenced
  code block for the fix.`;

const model = loadModel();

// One Agent per session so follow-up questions keep the roast in context.
const agents = new Map<string, Agent>();

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    async *process(payload: any, context: any) {
      const sessionId = context?.sessionId ?? 'default-session';
      let agent = agents.get(sessionId);
      if (!agent) {
        agent = new Agent({ model, systemPrompt: SYSTEM_PROMPT });
        agents.set(sessionId, agent);
      }

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

`loadModel()` points at **Amazon Nova Lite** — ~$0.06/$0.24 per million tokens on Bedrock, so roasts cost a fraction of a cent. But here's the thing that took the most iteration: **the hardest part of the prompt is the "no bug" path.** Cheap models are desperate to be helpful — hand them working code and they'll "improve" it with type checks and validation nobody asked for, which ruins the joke and gives bad advice. The prompt has to explicitly forbid that and tell the duck to just concede when the code is fine. Getting a cheap model to *shut up* was harder than getting it to roast.

> **Gotcha that cost me time:** the stream emits several event types, and you can only reach `event.event` after narrowing on `event.type` first. The three-part `if` above is what actually compiles — a bare `event.event?.delta?.type` throws a TypeScript error. Copy it exactly.

Swap the model ID in `model/load.ts` for Claude Haiku or Sonnet if you want more polish.

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

## Step 6: Make the endpoint public (the actually-hard part)

Here's the wrinkle nobody warns you about. Your agent is deployed — but the AgentCore endpoint requires **AWS SigV4-signed requests**. A browser can't call it directly, and you must **never** sign from client-side JS (that ships your AWS credentials in the page source). So you need something in the middle that holds an IAM role and signs on the browser's behalf.

The obvious move — a public Lambda Function URL with `AuthType: NONE` — *does not work*, and the reason is a great story: AWS's own security tooling detects the world-accessible Lambda and automatically scopes the permissions back down. Your calls quietly start returning `Forbidden`. The platform is protecting you from yourself.

The setup that actually holds up:

```text
CloudFront distribution   (public HTTPS, injects CORS, SigV4-signs to origin)
  → Lambda Function URL   (AuthType = AWS_IAM, streaming proxy)
    → AgentCore Runtime   (InvokeAgentRuntime)
```

CloudFront is the public face. It signs each request to a private, IAM-authed Lambda using an **Origin Access Control (OAC)**. The Lambda is never world-accessible; CloudFront is. The Lambda itself is tiny — it forwards the prompt to the runtime and streams the SSE response straight back:

```javascript
// proxy/index.mjs — the whole proxy, minus CORS boilerplate
export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const { prompt } = JSON.parse(event.body ?? '{}');

  const res = await client.send(new InvokeAgentRuntimeCommand({
    agentRuntimeArn: RUNTIME_ARN,
    runtimeSessionId: sessionId,        // AgentCore requires ≥ 33 chars
    accept: 'text/event-stream',
    contentType: 'application/json',
    payload: new TextEncoder().encode(JSON.stringify({ prompt })),
  }));

  // The runtime already emits well-formed `data: ...\n\n` SSE frames. Forward verbatim.
  for await (const chunk of res.response) responseStream.write(chunk);
  responseStream.end();
});
```

Two gotchas here each cost me an afternoon, so I'll save you both:

- **POST bodies need an `x-amz-content-sha256` header.** Lambda Function URLs behind OAC reject unsigned payloads — CloudFront signs *assuming the client already hashed the body*. So the browser has to send the SHA-256 of the request body, or you get "signature does not match."
- **CloudFront needs *both* `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction`.** Grant only the first and you still get `Forbidden`.

The repo's [`blogs/deployment-notes.md`](https://github.com/tmoreton/tutorials/blob/main/blogs/deployment-notes.md) has the exact CLI commands for the proxy, the OAC, the CORS response-headers policy, and the IAM — reproduce it from scratch in a few minutes.

---

## Step 7: The frontend — just the connection

The UI is one HTML file, no build step, and I'm going to spend almost no time on it because the interesting work is behind it. It's a paste box, an ASCII duck, and that dice button. The only part that matters is how it talks to the agent: **send the code, read back a Server-Sent Events stream**.

```javascript
const res = await fetch(API_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Accept": "text/event-stream",  // required — the agent streams SSE, not JSON
    "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": sessionId,
    // For prod, CloudFront's OAC needs the body hash (see Step 6):
    "x-amz-content-sha256": await sha256Hex(body),
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
  buffer = frames.pop();                 // keep any partial frame
  for (const frame of frames) {
    const line = frame.split("\n").find((l) => l.startsWith("data:"));
    if (line) onToken(JSON.parse(line.slice(5).trim()));  // append token to the page
  }
}
```

Two things to remember: the server **requires** `Accept: text/event-stream` (without it you get a JSON error, not a stream), and the response is a stream of token strings, not one JSON blob — which is what makes the roast type out live, like the duck is thinking. Locally the frontend detects `localhost` and skips CloudFront, talking straight to `agentcore dev` on port 8080.

One safety note since you're injecting model output into the page: **escape everything before you format any Markdown.** A dozen lines of regex handles bold and code fences without letting raw HTML through.

---

## Step 8: Put it on the internet

Push to GitHub, then **Settings → Pages → Deploy from branch `main`, folder `/`**. A minute later your duck is live — HTTPS, free, auto-deploying on every push. Point a custom domain at it (I use `unducked.com`), set the frontend's production endpoint to your CloudFront URL, and you've got a product.

```bash
git clone https://github.com/tmoreton/tutorials
open tutorials/index.html
```

---

## Watch the bill

The endpoint is public and unauthenticated — anyone with the URL can spend your Bedrock tokens. Nova Lite is cheap (a fraction of a cent per roast), but a viral moment shouldn't become a surprise invoice, so at minimum:

- **Set a reserved-concurrency cap on the Lambda** (I use 2). That's a hard ceiling on how fast anyone can burn tokens.
- **Add an AWS budget alarm** so you find out early.

---

## Locking it down (without a login wall)

The whole appeal of Unducked is that you click a link and roast some code — no signup, no API key. That's also the problem: a public, unauthenticated endpoint is a standing invitation for someone to script a loop against it, drain your token budget, and lock everyone else out. The goal is to make that *expensive and annoying* for an abuser while staying *frictionless* for a real visitor. Here's the stack of defenses I settled on, cheapest first — none of them ask the user to sign in.

**1. Cap the input size (already in the proxy).** The single biggest lever on cost is how many tokens each request carries. A roast needs a snippet, not a novel, so the proxy truncates the prompt before it ever reaches Bedrock:

```javascript
const MAX_PROMPT_CHARS = parseInt(process.env.MAX_PROMPT_CHARS ?? '8000');
// ...
const prompt = (body.prompt ?? '').slice(0, MAX_PROMPT_CHARS);
```

That one line turns "paste a 2 MB file and cost me dollars" into a non-event. It also bounds output indirectly — the system prompt already tells the duck to keep it tight.

**2. Reserved concurrency is your circuit breaker.** The Lambda cap from above isn't just about tokens — it's the ceiling on *total throughput*. With a reserved concurrency of 2, there is no amount of traffic that makes the bill run away; excess requests get throttled at the proxy, not billed at Bedrock. Set it deliberately low and treat it as the backstop behind everything else.

**3. Put AWS WAF in front of CloudFront — this is the real fix.** WAF (Web Application Firewall) is a rules engine that sits *in front of* your CloudFront distribution and inspects every request before it reaches your origin. Nothing changes in your Lambda or your frontend — you attach a "Web ACL" (a bundle of rules) to the distribution and CloudFront enforces it. For a public toy the one rule that matters is a **rate limit**, and it needs no login:

- **Rate-based rule, keyed by client IP.** WAF counts requests per IP over a rolling window (1, 2, 5, or 10 minutes) and acts on anyone over the limit. The floor is 100 requests per 5 minutes — well above a human clicking "Roast it," far below a script in a loop.
- **Challenge action instead of a hard block.** Rather than returning `403`, set the over-limit action to **Challenge** (or **CAPTCHA**). WAF serves a silent browser proof-of-work that a real browser passes invisibly but a `curl` loop or headless scraper fails. Crucially, the challenge *only* fires on requests above the rate limit — normal visitors stay under it and never see anything. This is the closest you get to "login-grade" protection with zero friction.
- **Geo or bot-control rules** if you want to go further — the AWS Managed Rules bot-control group catches common scrapers, though it adds cost.

To enable it, in the **WAF console**: create a Web ACL, set **Resource type → CloudFront distributions**, associate your distribution, add a **rate-based rule** (limit `100`, aggregate on **source IP**, evaluation window `5 minutes`), set its action to **Challenge**, and save. Or the one CLI call that does the same thing (CloudFront Web ACLs live in `us-east-1`):

```bash
aws wafv2 create-web-acl \
  --name unducked-rate-limit --scope CLOUDFRONT --region us-east-1 \
  --default-action Allow={} \
  --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=unducked \
  --rules '[{"Name":"rate-per-ip","Priority":0,
    "Statement":{"RateBasedStatement":{"Limit":100,"AggregateKeyType":"IP","EvaluationWindowSec":300}},
    "Action":{"Challenge":{}},
    "VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"rate-per-ip"}}]'
# then associate the returned Web ACL ARN with the distribution (set it as the distribution's WebACLId)
```

That's exactly what's guarding `unducked.com` right now. WAF's own logs and CloudWatch metrics then show you who got challenged, so you can watch for abuse without watching the bill.

**4. Keep CORS locked to your origin.** The proxy already restricts `Access-Control-Allow-Origin` to `https://unducked.com`. It won't stop a determined attacker (CORS is browser-enforced, and curl ignores it), but it stops the lazy case where someone embeds your endpoint from their own site.

The honest limit: without authentication you can't make abuse *impossible*, only *uneconomical*. But layering all four — an input cap, a hard concurrency ceiling of 2, a WAF rate-limit-plus-challenge, and CORS locked to the origin — is exactly what's live on `unducked.com`, and together they mean a casual attacker bounces off while a real visitor never notices a thing. A budget alarm catches anything that slips through. If it ever went truly viral-with-a-target-on-its-back, the next step would be a lightweight anonymous token (a per-session nonce your page mints), but for a code-roasting duck that's overkill.

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

The lesson underneath the jokes: a capable model plus a sharp system prompt is a shippable product, and the AI is the *cheap* part — the fiddly work is the plumbing that makes it public and safe. Change the prompt and Chef Duck becomes a patient mentor, a passive-aggressive senior dev, or a security auditor. Same stack, same afternoon.

---

## Source

[The complete code is on GitHub →](https://github.com/tmoreton/tutorials)

Go roast some code. Your duck is disappointed in you already.
