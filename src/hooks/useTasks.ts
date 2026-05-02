// Phase 7 Wave A.2: thin read-side hook over the task atoms.
//
// Mirrors v1's `useTasks` shape so call sites reading `tasks`,
// `selectedTask`, and `mainTask` port across without restructuring.
// Mutations are not wrapped here — components write through the action
// atoms directly (`upsertTaskAtom`, `removeTaskAtom`, etc.) or via the
// typed taskService introduced in Wave A.3.

import { useAtomValue } from 'jotai'

import {
  mainTaskAtom,
  selectedTaskAtom,
  tasksAtom,
} from '../store/atoms/tasks'
import type { Task } from '../types/task'

export interface UseTasksResult {
  tasks: Task[]
  selectedTask: Task | null
  mainTask: Task | null
}

export function useTasks(): UseTasksResult {
  const tasks = useAtomValue(tasksAtom)
  const selectedTask = useAtomValue(selectedTaskAtom)
  const mainTask = useAtomValue(mainTaskAtom)
  return { tasks, selectedTask, mainTask }
}
