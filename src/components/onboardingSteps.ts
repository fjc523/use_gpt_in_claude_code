export type OnboardingStepId =
  | 'preflight'
  | 'theme'
  | 'oauth'
  | 'api-key'
  | 'openai-auth'
  | 'security'
  | 'terminal-setup'

export function shouldEnterContinueOnboardingStep(
  stepId: OnboardingStepId | undefined,
): boolean {
  return stepId === 'openai-auth' || stepId === 'security'
}
