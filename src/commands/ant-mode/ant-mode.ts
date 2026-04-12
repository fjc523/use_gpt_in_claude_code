import { getAntPromptMode, setAntPromptMode } from '../../bootstrap/state.js'
import { clearSystemPromptSections } from '../../constants/systemPromptSections.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async () => {
  const newValue = !getAntPromptMode()
  setAntPromptMode(newValue)
  clearSystemPromptSections()

  return {
    type: 'text',
    value: `Ant prompt mode ${newValue ? 'enabled' : 'disabled'}. Next response will use the ${newValue ? 'ant' : 'standard'} prompt variant.`,
  }
}
