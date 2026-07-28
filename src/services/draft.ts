import { CalibrationDraft } from '../core/types'

let activeDraft: CalibrationDraft | undefined

export function setActiveDraft(draft: CalibrationDraft): void {
  activeDraft = draft
}

export function getActiveDraft(): CalibrationDraft | undefined {
  return activeDraft
}

export function clearActiveDraft(): void {
  activeDraft = undefined
}
