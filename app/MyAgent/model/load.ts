import { BedrockModel } from '@strands-agents/sdk/models/bedrock';

export function loadModel(): BedrockModel {
  // Claude Haiku 4.5: sharper judgment than Nova Micro (better at not inventing
  // bugs in clean code). Requires a cross-region inference profile; the global
  // profile avoids the 10% regional-endpoint premium.
  return new BedrockModel({ modelId: 'global.anthropic.claude-haiku-4-5-20251001-v1:0' });
}
