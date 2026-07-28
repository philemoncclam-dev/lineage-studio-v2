// Turning an assistant proposal into a model edit.
//
// This is the ONLY place a proposal becomes a change, and it deliberately owns
// no logic of its own: every kind maps onto the same `model/edit.ts` and
// `model/properties.ts` function a person's own click would call. So an applied
// proposal is indistinguishable from a hand edit — it lands in the undo history
// the same way, persists the same way, and is undone with the same ⌃Z.
//
// The backend has already validated each proposal against this model, so the
// happy path is the only path with real work in it. It is still written to be
// safe if that guarantee lapses: every editor function below is a no-op on
// invalid input (addTransition ignores a missing endpoint, setProperty ignores
// a reserved key), so a stale proposal applied against a model that has since
// changed does nothing rather than something wrong.
//
// Applying a batch folds them into ONE undo step on purpose. "Undo the
// assistant's suggestion" is a single intention; making the user press ⌃Z six
// times to reverse one Apply-all would be a worse promise than not offering the
// button.
import { addTransition } from '../model/edit'
import { renameEntity } from '../model/edit'
import { setProperty } from '../model/properties'
import { addTagTo } from '../model/tags'
import type { ProposedEdit } from '../api'
import type { LineageModel } from '../model/types'

export function applyProposal(model: LineageModel, edit: ProposedEdit): LineageModel {
  switch (edit.kind) {
    case 'add_transition':
      if (!edit.source_id || !edit.target_id) return model
      return addTransition(model, edit.source_id, edit.target_id)

    case 'set_property':
      if (!edit.entity_id || !edit.key || !edit.value) return model
      return setProperty(model, [edit.entity_id], edit.key, edit.value)

    case 'add_tag':
      if (!edit.entity_id || !edit.value) return model
      return addTagTo(model, [edit.entity_id], edit.value)

    case 'rename':
      if (!edit.entity_id || !edit.value) return model
      return renameEntity(model, edit.entity_id, edit.value)

    default:
      // An unknown kind from a newer backend: ignore it rather than throwing.
      // Losing one proposal is recoverable; a crash mid-batch would leave the
      // model half-edited with no record of where it stopped.
      return model
  }
}

export function applyProposals(model: LineageModel, edits: ProposedEdit[]): LineageModel {
  return edits.reduce(applyProposal, model)
}
