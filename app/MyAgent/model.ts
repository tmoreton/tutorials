import { BedrockModel } from '@strands-agents/sdk/models/bedrock';

export function loadModel(): BedrockModel {
  // Amazon Nova Lite: ~20x cheaper than Claude Haiku 4.5 ($0.06/$0.24 per 1M
  // tokens) but still smart enough to roast well and give real feedback —
  // noticeably sharper than Nova Micro. Requires the cross-region profile.
  return new BedrockModel({ modelId: 'us.amazon.nova-lite-v1:0' });
}
