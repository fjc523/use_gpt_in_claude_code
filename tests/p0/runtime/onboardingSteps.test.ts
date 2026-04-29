import { describe, expect, it } from 'vitest'
import { shouldEnterContinueOnboardingStep } from '../../../src/components/onboardingSteps.js'

describe('onboarding key handling', () => {
  it('[P0:runtime] accepts Enter on every onboarding step that renders PressEnterToContinue', () => {
    expect(shouldEnterContinueOnboardingStep('openai-auth')).toBe(true)
    expect(shouldEnterContinueOnboardingStep('security')).toBe(true)
  })

  it('[P0:runtime] leaves interactive onboarding steps to their own controls', () => {
    expect(shouldEnterContinueOnboardingStep('theme')).toBe(false)
    expect(shouldEnterContinueOnboardingStep('terminal-setup')).toBe(false)
    expect(shouldEnterContinueOnboardingStep(undefined)).toBe(false)
  })
})
