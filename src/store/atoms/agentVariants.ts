import { TauriCommands } from '../../common/tauriCommands'
import type { AgentVariant } from '../../types/agentVariant'
import { createSettingsListAtoms } from './createSettingsListAtoms'

const atoms = createSettingsListAtoms<AgentVariant>({
    loadCommand: TauriCommands.GetAgentVariants,
    saveCommand: TauriCommands.SetAgentVariants,
    saveParamName: 'variants',
    label: 'agent variants',
})

export const agentVariantsListAtom = atoms.listAtom
export const agentVariantsLoadingAtom = atoms.loadingAtom
export const agentVariantsErrorAtom = atoms.errorAtom
export const loadAgentVariantsAtom = atoms.loadAtom
export const saveAgentVariantsAtom = atoms.saveAtom
