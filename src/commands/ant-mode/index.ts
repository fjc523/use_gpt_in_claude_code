import type { Command } from '../../types/command.js'

const command = {
  type: 'local',
  name: 'ant',
  description: 'Toggle ant prompt mode (stricter comments, thoroughness, output efficiency)',
  isHidden: false,
  load: () => import('./ant-mode.js'),
} satisfies Command

export default command
