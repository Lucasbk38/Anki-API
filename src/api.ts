import { showError } from './extension'
import 'colors'
import { log, logError } from './log'


const requestAnkiAPI = async <R> (action: string, params = {}) => {
	log(`API request: ${action}`.cyan, params)

	

	return await fetch('http://127.0.0.1:8765', {
		method: 'POST',
		body: JSON.stringify({
			action,
			version: 6,
			params
		}),
		headers: {
			'Content-type': 'application/json; charset=UTF-8',
		}
	})
		.then(async value => await value.json() as { result: R } | { error: Error })
		.then(value => {
			if ('result' in value)
				return value.result

			throw value.error
		})
		.catch(async (err): Promise<R> => {
			if (err && err.cause && err.cause.code === 'ECONNREFUSED') {
				const result = await showError<R | undefined>(
					'Unable to connect to the API, you should try to start or restart the Anki App',
					[
						{ name: 'Retry', callback: () => requestAnkiAPI(action, params) },
						{ name: 'Cancel', callback: async () => undefined },
					]
				)
    
				if (result)
					return result
			}

			logError('AnkiAPIError', action, err)
    
			throw err
		})
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// AnkiConnect answers with `null` when Anki is busy (e.g. right after a sync or while a
// dialog is open). Read requests should never legitimately be null, so retry, then fail clearly.
const requestRequired = async <R> (action: string, params = {}, attempts = 6): Promise<NonNullable<R>> => {
	for (let i = 0; i < attempts; i++) {
		const result = await requestAnkiAPI<R>(action, params)

		if (result !== null && result !== undefined)
			return result as NonNullable<R>

		await sleep(500 * (i + 1))
	}

	throw new Error(`Anki did not answer the "${ action }" request (empty response). Anki is probably busy syncing or showing a dialog: wait a few seconds and try again.`)
}

export type InputCard = {
	deckName:  string
	modelName: string
	fields:    Record<string, string>
}

export type OutputNote = {
	deckName:  string
	modelName: string
	noteId:    number
	fields:    Record<string, { value: string, order: number }>
}

export type Model = {
	id:   number
	name: string
	flds: {
		name: string
		ord:  number
	}[]
}



export const syncAnki = () => requestAnkiAPI<void>('sync')
export const getDecksWithIds = () => requestRequired<Record<string, number>>('deckNamesAndIds')
export const createDeck = (deckName: string) => requestAnkiAPI<number>('createDeck', { deck: deckName })
export const findNotes = (deckName: string) => requestRequired<number[]>('findNotes', { query: `"deck:${ deckName }"` })
export const getNotesInfo = (notesIds: number[]) => requestRequired<OutputNote[]>('notesInfo', { notes: notesIds })
export const getModels = () => requestRequired<string[]>('modelNames')
export const createNote = (note: InputCard) => requestAnkiAPI<number>('addNote', { note })
export const createNotes = (notes: InputCard[]) => requestAnkiAPI<number[]>('addNotes', { notes })
export const updateNote = (card: Partial<InputCard> & { id: number }) => requestAnkiAPI<number[]>('updateNoteFields', { note: card })
export const findModel = (modelName: string) => requestRequired<Model[]>('findModelsByName', { modelNames: [modelName] }).then(([e]) => e)

// findModel('Anglais')
// 	.then(model => model.flds.sort().map(e => e.name))
// 	.then(fields =>
// 		createNote({
// 			deckName: 'Tests',
// 			modelName: 'Anglais',
// 			fields: Object.fromEntries(fields.map((field, i) => [field, ['fr', 'ang'][i]]))
// 		}).then(console.log).catch(console.error)
// 	)