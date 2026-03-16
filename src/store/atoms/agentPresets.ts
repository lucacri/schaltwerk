import { TauriCommands } from '../../common/tauriCommands'
import type { AgentPreset } from '../../types/agentPreset'
import { createSettingsListAtoms } from './createSettingsListAtoms'

const atoms = createSettingsListAtoms<AgentPreset>({
    loadCommand: TauriCommands.GetAgentPresets,
    saveCommand: TauriCommands.SetAgentPresets,
    saveParamName: 'presets',
    label: 'agent presets',
})

export const agentPresetsListAtom = atoms.listAtom
export const agentPresetsLoadingAtom = atoms.loadingAtom
export const agentPresetsErrorAtom = atoms.errorAtom
export const loadAgentPresetsAtom = atoms.loadAtom
export const saveAgentPresetsAtom = atoms.saveAtom
