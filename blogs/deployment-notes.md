# Deployment Notes

What it actually took to get the public UI talking to the deployed agent. The blog post keeps things simple; this file records the real-world gaps and fixes so the repo is reproducible.

## Architecture (as deployed)

```
Browser (GitHub Pages)
  → CloudFront distribution  (public HTTPS, injects CORS, SigV4-signs to origin via OAC)
    → Lambda Function URL     (AUTH_TYPE = AWS_IAM, streaming proxy)
      → AgentCore Runtime     (InvokeAgentRuntime)
        → Amazon Bedrock       (Nova Lite)
```

Local dev keeps the simple path: the frontend detects `localhost` and calls `agentcore dev` on `http://localhost:8080/invocations` directly.

## Deployed resources (account 253170388727)

| Resource | Value |
|----------|-------|
| Region (agent + Lambda) | `us-west-2` |
| AgentCore Runtime ARN | `arn:aws:bedrock-agentcore:us-west-2:253170388727:runtime/MyAgent_MyAgent-FMV4cF8yar` |
| CloudFormation stack | `AgentCore-MyAgent-default` |
| Model | `us.amazon.nova-lite-v1:0` (see `app/MyAgent/model/load.ts`) |
| Proxy Lambda | `MyAgent-proxy` (nodejs22, arm64, RESPONSE_STREAM, reserved concurrency 5) |
| Lambda role | `MyAgent-proxy-role` |
| CloudFront distribution | `E1QLW6Q26MYNBG` → `d1tot2sdhkxrue.cloudfront.net` |
| Origin Access Control | `E248PSODOIURJF` |
| CORS response-headers policy | `a4035c31-c33d-4af6-9fcd-0c286b94104c` |
| Frontend | GitHub Pages, `main` / root → `https://unducked.com/` |

## The problems we hit, and the fixes

### 1. The blog's agent code doesn't run on the current CLI
The post shows `export default async function handler(...)`. The installed AgentCore CLI (v0.23+) expects a server built on `BedrockAgentCoreApp` that exposes `/invocations` and `/ping`. **Fix:** use the scaffolded `BedrockAgentCoreApp` app server (see `app/MyAgent/main.ts`) with a streaming `process` generator.

### 2. The response is a stream, not `{result: "..."}`
The agent emits **Server-Sent Events** and *requires* an `Accept: text/event-stream` request header — without it you get a JSON error, not the answer. Each frame is `data: "<json-encoded token>"`. **Fix:** the frontend sends the `Accept` header and parses the SSE stream, concatenating token deltas.

### 3. The deployed endpoint is not browser-callable
`InvokeAgentRuntime` requires SigV4-signed requests. You can't sign from browser JS without leaking AWS credentials. **Fix:** a Lambda proxy holds an IAM role and signs on the browser's behalf (`proxy/index.mjs`). It streams the runtime's SSE straight back to the client.

### 4. A public Lambda Function URL gets auto-mitigated
Setting the Function URL to `AuthType: NONE` with a `Principal: "*"` resource policy triggers the **Palisade "world-accessible Lambda" detector**; Epoxy automatically scopes the policy down, and calls start returning `Forbidden`. **Fix:** don't make the Lambda public. Set the Function URL to `AWS_IAM` and put **CloudFront with an Origin Access Control (OAC)** in front. CloudFront is the public surface; it SigV4-signs each origin request. The Lambda is never world-accessible.

### 5. OAC + POST body → "signature does not match"
Lambda Function URLs behind OAC **do not accept unsigned payloads**. CloudFront signs assuming the client provided the payload hash. **Fix:** the client must send `x-amz-content-sha256` = SHA-256 hex of the request body. The frontend computes this with `crypto.subtle.digest` for production requests. The distribution also uses the **AllViewerExceptHostHeader** origin request policy so that header reaches the origin.

### 6. OAC needs TWO Lambda permissions
Granting only `lambda:InvokeFunctionUrl` still returns `Forbidden`. CloudFront needs **both** `lambda:InvokeFunctionUrl` **and** `lambda:InvokeFunction`, each scoped to the distribution's `SourceArn`.

### 7. CORS preflight failed (the "Something went wrong" error)
The browser sends an `OPTIONS` preflight before the POST (custom headers force it). Once URL-level CORS was removed for the IAM switch, CloudFront answered the preflight with a bare `200` and **no `Access-Control-Allow-*` headers**, so the browser blocked the real request. **Fix:** attach a **CloudFront response-headers policy** with the CORS config (origin `https://tmoreton.github.io`, methods `POST,OPTIONS`, the custom headers) to the distribution.

## Reproduce from scratch

```bash
# 1. Agent
cd app/MyAgent && npm install && npm run build && cd ../..
agentcore deploy --yes                       # creates runtime + stack

# 2. Proxy Lambda (bundle, role, function, IAM-auth Function URL)
cd proxy && npm install
npx esbuild index.mjs --bundle --platform=node --target=node22 --format=esm \
  --outfile=dist/index.mjs \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);"
(cd dist && zip -q ../function.zip index.mjs)
# create role MyAgent-proxy-role (trust: lambda.amazonaws.com) with:
#   - AWSLambdaBasicExecutionRole
#   - inline: bedrock-agentcore:InvokeAgentRuntime on the runtime ARN
aws lambda create-function --function-name MyAgent-proxy --runtime nodejs22.x \
  --architectures arm64 --handler index.handler --role <role-arn> \
  --zip-file fileb://function.zip --timeout 120 --memory-size 256 \
  --environment "Variables={AGENT_RUNTIME_ARN=<runtime-arn>,ALLOW_ORIGIN=https://unducked.com,MAX_PROMPT_CHARS=8000}" \
  --region us-west-2
aws lambda put-function-concurrency --function-name MyAgent-proxy \
  --reserved-concurrent-executions 5 --region us-west-2
aws lambda create-function-url-config --function-name MyAgent-proxy \
  --auth-type AWS_IAM --invoke-mode RESPONSE_STREAM --region us-west-2

# 3. CloudFront: OAC (origin type lambda, sigv4/always) + distribution with
#    CachePolicy CachingDisabled, OriginRequestPolicy AllViewerExceptHostHeader,
#    and a CORS response-headers policy. Then grant CloudFront access:
aws lambda add-permission --function-name MyAgent-proxy \
  --statement-id AllowCloudFrontServicePrincipal --action lambda:InvokeFunctionUrl \
  --principal cloudfront.amazonaws.com --function-url-auth-type AWS_IAM \
  --source-arn arn:aws:cloudfront::253170388727:distribution/<dist-id> --region us-west-2
aws lambda add-permission --function-name MyAgent-proxy \
  --statement-id AllowCloudFrontServicePrincipalInvokeFunction --action lambda:InvokeFunction \
  --principal cloudfront.amazonaws.com \
  --source-arn arn:aws:cloudfront::253170388727:distribution/<dist-id> --region us-west-2

# 4. Point index.html PROD_API at the CloudFront domain, push, enable Pages.
```

## Abuse mitigation (public, no-login)

The endpoint is public and unauthenticated, so the defenses are layered to make abuse
uneconomical rather than impossible:

1. **Prompt-size cap** — the proxy truncates `prompt` to `MAX_PROMPT_CHARS` (8000) before
   calling Bedrock, bounding per-request token cost. Env var, no redeploy of logic needed.
2. **Reserved concurrency** — hard ceiling on throughput (set low, e.g. 2). Excess requests
   throttle at the proxy, never reaching Bedrock.
3. **WAF on the CloudFront distribution** — the real rate limiter. Attach a WebACL with a
   rate-based rule keyed by client IP (evaluation window 1/2/5/10 min; floor 100 req/5 min),
   action **Challenge** (silent browser proof-of-work — passes for real browsers, fails for
   curl/headless loops; no login). Optionally add the managed bot-control group.

   ```bash
   aws wafv2 create-web-acl --name unducked-rate-limit --scope CLOUDFRONT \
     --region us-east-1 --default-action Allow={} \
     --visibility-config SampledRequestsEnabled=true,CloudWatchMetricsEnabled=true,MetricName=unducked \
     --rules '[{"Name":"rate","Priority":0,"Statement":{"RateBasedStatement":{"Limit":100,"AggregateKeyType":"IP","EvaluationWindowSec":300}},"Action":{"Challenge":{}},"VisibilityConfig":{"SampledRequestsEnabled":true,"CloudWatchMetricsEnabled":true,"MetricName":"rate"}}]'
   # then associate the WebACL ARN with the distribution (CLOUDFRONT scope WebACLs live in us-east-1)
   ```
4. **CORS locked to origin** — `ALLOW_ORIGIN=https://unducked.com`. Stops casual cross-site
   embedding; not a real barrier against curl (CORS is browser-enforced).
5. **Budget alarm** — the backstop that catches anything the above misses.

## Teardown

Delete in order: WAF WebACL (disassociate from distribution first) → CloudFront distribution (disable, then delete) → OAC → response-headers policy → Lambda + `MyAgent-proxy-role` → `agentcore` stack (`aws cloudformation delete-stack --stack-name AgentCore-MyAgent-default`).
