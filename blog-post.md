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

By the end, you'll have a working chat interface backed by Claude Sonnet on AWS, deployed to a hosted endpoint, costing fractions of a cent per conversation. And it's the foundation for everything that comes next: memory, authentication, document Q&A, guardrails. But today we keep it dead simple.

**What you'll need:** An AWS account, Node.js 22+, and npm. That's it.

Let's go.

---

## The mental model: an agent is a model + a prompt

Before we touch code, here's what we're building:

```
Browser (HTML + JS) → AgentCore Runtime (hosted endpoint) → Strands Agent → Bedrock (Claude)
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
│   └── aws-targets.json      # Account + region
└── app/
    └── MyAgent/
        ├── main.ts           # Your agent ← this is the file that matters
        ├── package.json      # Dependencies
        └── tsconfig.json
```

---

## Step 3: Write the agent

Open `app/MyAgent/main.ts` and replace it with:

```typescript
import { Agent } from '@strands-agents/sdk'

const agent = new Agent({
  systemPrompt: 'You are a helpful AI assistant. Be concise and direct.',
})

export default async function handler(payload: { prompt?: string }) {
  const userMessage = payload.prompt ?? 'Hello!'
  const result = await agent.invoke(userMessage)
  return { result: result.lastMessage }
}
```

That's the whole thing. Let's break it down:

- `new Agent()` creates a Strands agent. Defaults to Claude Sonnet 4 on Bedrock. No API keys, no client setup. It uses your AWS credentials directly.
- `systemPrompt` tells the model who it is. Customize this to whatever you want.
- `agent.invoke(message)` sends the message through the agent loop and returns an `AgentResult`.
- `result.lastMessage` is the text response.

~10 lines of logic. That's your entire backend.

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
// The only part that matters — call your agent and display the response
async function send(text) {
  const res = await fetch("http://localhost:8080/invocations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: text }),
  });
  const data = await res.json();
  return data.result; // ← the agent's response
}
```

That's the entire integration. One `fetch` to `localhost:8080/invocations` with a JSON body containing your prompt. The rest is just HTML and CSS to make it look like a chat window.

The full `index.html` (dark theme, chat bubbles, enter-to-send) is in the repo. Clone it, run `agentcore dev`, open the file in your browser. That's your ChatGPT.

```bash
# Grab the frontend
git clone https://github.com/tmoreton/chatgpt-clone-aws
open chatgpt-clone-aws/index.html
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

> **Heads up:** Right now the frontend calls `localhost:8080`, so you need `agentcore dev` running locally. In Post 2, we add API Gateway as a public proxy in front of your deployed agent. You'll update one line in the frontend, push, and it's live for anyone.

---

## The honest gotchas list

These cost me time so they don't cost you:

1. **"Access denied" from Bedrock.** Your IAM identity needs `bedrock:InvokeModel` permission. Personal accounts with admin access are fine. Org accounts with locked-down roles need policy updates.

2. **First `agentcore deploy` takes 3-5 minutes.** CDK bootstraps your account on the first run. Subsequent deploys are faster.

3. **TypeScript compilation errors.** Make sure `"type": "module"` is set in package.json and your tsconfig is correct. Run `npm run build` locally to catch errors before deploying.

4. **Cold starts.** The runtime scales down when idle. First request after inactivity takes extra seconds.


---

## Where to take it next

Right now this is a starting point. It works locally, it's deployed, it's cheap. But the conversation resets every message, there's no auth, and the deployed endpoint isn't browser-accessible yet.

The next posts in this series fix that:

- **Post 2: Add memory + a public endpoint** — AgentCore Memory for conversation persistence. API Gateway for a browser-callable URL.
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
| Model | Claude Sonnet 4 | Amazon Bedrock |
| Agent | ~10 lines of TypeScript | Strands Agents SDK |
| Backend hosting | `agentcore deploy` | AgentCore Runtime |
| Frontend hosting | Push to GitHub | GitHub Pages |

All deployed from your terminal. Zero console visits.

---

## Source

[The complete code for this tutorial is on GitHub →](https://github.com/tmoreton/chatgpt-clone-aws)

---

*If this was useful, follow along. The next post drops next week.*
