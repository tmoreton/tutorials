import { BedrockModel } from '@strands-agents/sdk/models/bedrock';

export function loadModel(): BedrockModel {
  // Nova Micro: cheapest Bedrock text model — ideal for a demo. It has no
  // on-demand base-ID support, so the cross-region inference profile ID is required.
  return new BedrockModel({ modelId: 'us.amazon.nova-micro-v1:0' });
}
