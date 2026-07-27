import { BedrockModel } from '@strands-agents/sdk/models/bedrock';

// Amazon Nova Micro: Bedrock's cheapest text model. Requires the cross-region
// inference-profile ID (the "us." prefix) — there is no on-demand base ID.
// Swap this for e.g. 'global.anthropic.claude-sonnet-4-5-20250929-v1:0' for more power.
export function loadModel(): BedrockModel {
  return new BedrockModel({ modelId: 'us.amazon.nova-micro-v1:0' });
}
