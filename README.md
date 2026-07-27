# Build Your Own ChatGPT with AWS

A minimal ChatGPT-style chat interface powered by the Strands Agents SDK and Amazon Bedrock AgentCore.

## Architecture

```
index.html → AgentCore Runtime → Strands Agent → Bedrock (Claude Sonnet 4)
```

## Prerequisites

- AWS account with credentials configured
- Node.js 22+
- npm

## Quick Start

```bash
# 1. Install the AgentCore CLI
npm install -g @aws/agentcore

# 2. Install agent dependencies
cd app/MyAgent && npm install && cd ../..

# 3. Start the local dev server
agentcore dev

# 4. Open the frontend
open index.html
```

## Deploy

```bash
# Deploy the agent to AWS
agentcore deploy

# Deploy the frontend to GitHub Pages
git init && git add . && git commit -m "initial commit"
gh repo create chatgpt-clone-aws --public --push
# Enable GitHub Pages: Settings > Pages > Source: main branch, / (root)
```

## Project Structure

```
chatgpt-clone-aws/
├── app/
│   └── MyAgent/
│       ├── main.ts           # Agent code (~10 lines)
│       ├── package.json
│       └── tsconfig.json
├── index.html                # Chat UI (ChatGPT-style)
├── blog-post.md              # The accompanying tutorial
└── README.md
```

## Blog Series

This repo accompanies the "Build Your Own ChatGPT" blog series on dev.to:

1. **Build Your Own ChatGPT in 30 Minutes** (this repo)
2. Add memory + a public endpoint
3. Add authentication
4. Chat with your documents (RAG)
5. Add guardrails
6. Give it tools
7. Go to production

## License

MIT
