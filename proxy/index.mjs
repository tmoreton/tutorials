import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore';

const RUNTIME_ARN = process.env.AGENT_RUNTIME_ARN;
// Lock CORS to the site origin. "*" is allowed for quick demos but prefer the exact origin.
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? '*';
// Cap the prompt size so a single request can't blow up token cost. ~8k chars
// is plenty for a code snippet; anything larger is abuse, not a roast.
const MAX_PROMPT_CHARS = parseInt(process.env.MAX_PROMPT_CHARS ?? '8000');

const client = new BedrockAgentCoreClient({});

const corsHeaders = {
  'Access-Control-Allow-Origin': ALLOW_ORIGIN,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Amzn-Bedrock-AgentCore-Runtime-Session-Id, X-Amz-Content-Sha256',
  'Access-Control-Max-Age': '86400',
};

// AgentCore requires a runtimeSessionId of at least 33 characters.
function normalizeSessionId(id) {
  const candidate = (id ?? '').trim();
  if (candidate.length >= 33) return candidate;
  return (candidate + '-' + '0'.repeat(33)).slice(0, 40);
}

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const method = event.requestContext?.http?.method ?? 'POST';

  if (method === 'OPTIONS') {
    responseStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 204,
      headers: corsHeaders,
    });
    responseStream.end();
    return;
  }

  const sseStream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });

  try {
    const body = event.body
      ? JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body)
      : {};
    const prompt = (body.prompt ?? '').slice(0, MAX_PROMPT_CHARS);

    const headerSession =
      event.headers?.['x-amzn-bedrock-agentcore-runtime-session-id'] ??
      event.headers?.['X-Amzn-Bedrock-AgentCore-Runtime-Session-Id'];
    const sessionId = normalizeSessionId(headerSession);

    const res = await client.send(
      new InvokeAgentRuntimeCommand({
        agentRuntimeArn: RUNTIME_ARN,
        runtimeSessionId: sessionId,
        accept: 'text/event-stream',
        contentType: 'application/json',
        payload: new TextEncoder().encode(JSON.stringify({ prompt })),
      })
    );

    // response.response is an async iterable of Uint8Array chunks. Forward verbatim —
    // the runtime already emits well-formed `data: ...\n\n` SSE frames.
    for await (const chunk of res.response) {
      sseStream.write(chunk);
    }
  } catch (err) {
    sseStream.write(`data: ${JSON.stringify({ error: String(err?.message ?? err) })}\n\n`);
  } finally {
    sseStream.end();
  }
});
