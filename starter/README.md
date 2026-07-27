# Starter: Build Your Own ChatGPT

The smallest working version of the tutorial — an AI chat app you can run locally in a few minutes. This is the code we go through in the video.

```
starter/
├── app/MyAgent/
│   ├── main.ts          # The agent (~25 lines) ← the file that matters
│   ├── model/load.ts    # Which Bedrock model (Nova Micro by default)
│   ├── package.json
│   └── tsconfig.json
├── agentcore/           # Project config + CDK (generated, don't edit)
└── index.html           # The chat UI — open in a browser
```

## Prerequisites

- An AWS account with credentials configured (`aws sts get-caller-identity` should work)
- Node.js 22+
- The AgentCore CLI: `npm install -g @aws/agentcore`
- Amazon Nova Micro access enabled in Bedrock (region `us-west-2` by default)

## Run it locally

```bash
# 1. Install the agent's dependencies
cd app/MyAgent && npm install && cd ../..

# 2. Start the local dev server (compiles + serves on http://localhost:8080)
agentcore dev

# 3. In your browser, open index.html
#    (double-click it, or: open index.html)
```

Type a message and you'll see the response stream back token by token.

> **Note:** `index.html` talks to `http://localhost:8080`, so `agentcore dev`
> must be running. This starter is local-only — deploying to AWS and making the
> UI public (Lambda proxy + CloudFront) is covered in the main project one level up.

## Deploy the agent to AWS (optional)

```bash
agentcore deploy          # first deploy takes a few minutes (CDK bootstrap)
agentcore invoke "Hello!" --stream
```

## Swap the model

Edit `app/MyAgent/model/load.ts`. Nova Micro is the cheapest option; for more
reasoning power use e.g. `global.anthropic.claude-sonnet-4-5-20250929-v1:0`.
