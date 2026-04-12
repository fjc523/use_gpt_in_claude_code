import { getOpusPromptMode, setOpusPromptMode } from '../../bootstrap/state.js'
import { clearSystemPromptSections } from '../../constants/systemPromptSections.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async () => {
  const newValue = !getOpusPromptMode()
  setOpusPromptMode(newValue)
  clearSystemPromptSections()

  return {
    type: 'text',
    value: `Opus prompt mode ${newValue ? 'enabled' : 'disabled'}. Next response will use the ${newValue ? 'opus' : 'standard'} prompt variant.`,
  }
}
