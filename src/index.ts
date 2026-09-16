import { createDeck, findNotes, getNotesInfo, getDecksWithIds, getModels, updateNote, createNotes, syncAnki, findModel, createNote } from './api'
import { showError, showNotification } from './extension'
import { readdir, readFile } from 'fs/promises'
import { createDebounce } from './debounce'
import { Position, Range } from 'vscode'
import { parseField } from './parseMd'
import { EOL } from 'os'

import path from 'path'

export const configFileName = 'ankiconfig.json'

type HeaderData = {
	id?: number
}


type TSCard = {
	header: {
		data: HeaderData
	}
	fields: string[]
	edit: (data: {
		id: number
	}) => void
}

export const showCardUpdatedStatus = (card: TSCard, status: string) => {
	const rawCardName = card.fields[0]
	const matched = /^(?:<(\w+)>(?<a>.+)<\/\1>|&lt;(.+)&gt;(?<b>.+)&lt;\/\3&gt;|(?<c>.+))$/.exec(rawCardName.trim())!
	const cardName = matched.groups!.a ?? matched.groups!.b ?? matched.groups!.c
	
	showNotification('info', `Card "${ cardName.trim() }" ${ status }`)
}

const parseHeader = (line: string) => {
	const matchedLine = /^(#+)\s+((?:[^<]|.(?!!--))+)(<!--(.*)-->)?$/d.exec(line)

	if (!matchedLine)
		return null

	let [tags, name, , rawData = ''] = matchedLine.slice(1)

	const data = {} as Record<string, string | boolean | number | (string | boolean | number)[]>

	const parseValue = (value: string) => {
		if ([ 'true', 'false' ].includes(value))
			return value === 'true'

		else if (/^\d+$/.test(value))
			return parseInt(value)

		else
			return value
	}

	for (let i = 0; i < rawData.length;) {
		const keyMatch = /^\s*(\w+)\s*:/.exec(rawData.slice(i))

		if (keyMatch) {
			i += keyMatch[0].length
            
			let v = ''
			let inArr = false

			while (i < rawData.length) {
				if (rawData[i] === '\\') {
					i++
					v += rawData[i]
					i++
				}

				else if (rawData[i] === '[') {
					if (inArr) throw new Error()
						
					inArr = true

					v += rawData[i]
					i++
				}
				
				else if (rawData[i] === ']') {
					if (!inArr) throw new Error()
						
					inArr = false

					v += rawData[i]
					i++
				}
				
				else if (rawData[i] === ',' && !inArr) {
					break
				}
				
				else {
					v += rawData[i]
					i++
				}
			}

			if (v.includes('[')) {
				const content = v.trim()

				if (content[0] !== '[' || content[content.length - 1] !== ']')
					throw new Error()

				data[keyMatch[1]] = content.slice(1, -1).split(',').map(e => e.trim()).map(parseValue)
			} else {
				data[keyMatch[1]] = parseValue(v.trim())
			}
		} else {
			const nameMatch = /^\s*(\w+)\s*/.exec(rawData.slice(i))

			if (!nameMatch)
				throw new Error(`Unable to parse header metadata "${rawData.slice(i)}"`)
			
			data[nameMatch[1]] = true
			i += nameMatch[0].length
		}
        
		if (rawData[i] === ',')
			i++
		else if (i !== rawData.length)
			throw new Error(`Unable to parse header metadata "${rawData.slice(i)}"`)
	}

	if (typeof data.name === 'string')
		name = data.name

	return { level: tags.length, name, data, dataLocation: matchedLine.indices![3] }
}

type Config = {
	templateNameAsHeader: boolean
	template: string
	root: string
	macros: Macro[]
	parseMd: boolean
	relativeDeck: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const getConfig = async (filePath: string, ask: Ask, editFile: (file: string, edit: ToEdit & { method: 'replace' }) => Promise<void>) => {

	const parseConfig = async (config: Config) => {
		if (typeof config.templateNameAsHeader !== 'boolean')
			throw new Error('invalid templateNameAsHeader in config')

		if (!config.template)
			throw new Error('no template in config')

		if (!config.root)
			throw new Error('no root in config')
		
		const models = await getModels()
		
		if (!models.includes(config.template)) {
			// const newModel = await ask({
			// 	type: 'closed',
			// 	question: `Template "${ config.template }" does not exist, which template would you like to use by default ?`,
			// 	options: models
			// })

			// if (!newModel)
			// 	return
			// }

			throw new Error('Unable to automatically update config file')
		}
		
		return config
	}

	const getConfigFromDir = async (dirPath: string, demander = dirPath): Promise<Config> => {
		console.log(dirPath, demander)
		const parent = path.dirname(dirPath)
        
		if (parent === dirPath)
			return {} as Config
		
		const parentConfig = await getConfigFromDir(parent, demander)
		
		if ((await readdir(dirPath)).includes(configFileName)) {
			const configFilePath = path.join(dirPath, configFileName)
			const buffer = await readFile(configFilePath)
			const configContent = buffer.toString()
			const config = JSON.parse(configContent) as Config
			const root = config?.root ?? parentConfig?.root
			const relativeDeck = [ root ].concat(demander.slice(dirPath.length).split('/').filter(e => e)).join('::')

			return {
				root,
				template: config?.template ?? parentConfig?.template,
				macros: (config?.macros ?? []).concat(parentConfig?.macros ?? []),
				templateNameAsHeader: config?.templateNameAsHeader ?? parentConfig?.templateNameAsHeader ?? true,
				parseMd: config?.parseMd ?? parentConfig?.parseMd ?? false,
				relativeDeck: config.root ? relativeDeck : parentConfig.relativeDeck
			} satisfies Config
		}

		return parentConfig
	}

	return parseConfig(await getConfigFromDir(path.dirname(path.resolve(filePath))))
}

export type Asker <S extends string = string> = {
	type: 'open'
	question: string
	placeholder?: string
	value?: string
} | {
	type: 'closed'
	question: string
	options: S[]
}

type Ask = <S extends string>(data: Asker<S>) => Promise<S | undefined>

export type RecoverOptions <R> = { name: string, callback: () => Promise<R> }[]

export type ToEdit = {
	method: 'insert'
	position: Position
	value: string
} | {
	method: 'delete'
	range: Range
} | {
	method: 'replace'
	range: Range
	value: string
}

const trimArray = (arr: string[]) => {
	const trimStart = (array: string[]) => array.reduce((g, c) => (g.length === 0 && !c) ? g : g.concat([ c ]), [] as string[])

	return trimStart(trimStart(arr).reverse()).reverse()
}

export type Macro = {
	name: string
	priority?: boolean
	arguments?: number
	let?: boolean
	content: string
	new?: boolean
}

export const extendLatex = (rawContent: string, macros: Macro[], ankiLatex: boolean): string => {
	const includedMacros: string[] = []

	if (ankiLatex)
		return extendLatex(rawContent, macros.concat([
			{
				name: 'set',
				arguments: 1,
				content: '\\left\\{#1\\right\\}'
			},
			{
				name: 'underbar',
				arguments: 1,
				content: '\\underline #1'
			}
		]), false)

	let priorityContent = ''

	const content = () => (priorityContent ? (priorityContent + ' ') : '') + rawContent

	// eslint-disable-next-line no-constant-condition
	outer: while (true) {
		for (const macro of macros.filter(e => !includedMacros.includes(e.name))) {
			if (new RegExp(`\\\\${ macro.name }(?![A-Za-z])`).test(content())) {
				const macroText = macro.let ? `\\let\\${ macro.name + macro.content }` : `\\${(macro.new ?? true) ? 'newcommand' : 'renewcommand'}{\\${macro.name}}[${macro.arguments ?? 0}]{${macro.content}} `

				if (macro.priority)
					priorityContent = macroText + priorityContent
				else
					rawContent = macroText + rawContent

				includedMacros.push(macro.name)
				continue outer
			}
		}

		break
	}

	return content()
}

const compileData = (data: Record<string, string | number | boolean | (string | number | boolean)[]>, includeLeadingSpace: boolean) => {
	const content = Object.entries(data).map(([k, v]) => v === true ? k : `${k}: ${Array.isArray(v) ? `[ ${v.join(', ')} ]` : v}`).join(', ')

	if (!content)
		return ''

	return (includeLeadingSpace ? ' ' : '') + `<!--${ content }-->`
}

export class FileHandler {
	private lines: string[]
	private existingDecks: Awaited<ReturnType<typeof getDecksWithIds>> = {}
	private edits: ToEdit[] = []
	private edit: () => void

	constructor (
		fileContent: string,
		private config: Config,
		edit: (edits: ToEdit[]) => void,
		private ask: Ask
	) {
		this.edit = () => {
			edit(this.edits)
			this.edits = []
		}


		this.lines = fileContent.split(EOL)
	}

	private addToLine (line: number, data: Record<string, string | number | number[]>) {
		const compiledData = compileData(data, this.lines[line].slice(-1)[0] !== ' ')

		if (!compiledData)
			return

		this.edits.push({
			method: 'insert',
			position: new Position(line, this.lines[line].length),
			value: compiledData
		})
	}

	private addToEnd (lines: string[]) {
		const line = this.lines.length - 1

		this.edits.push({
			method: 'insert',
			position: new Position(line, this.lines[line].length),
			value: lines.join(EOL)
		})
	}

	private modifyLineData (line: number, data: Record<string, string | number | number[]>) {
		const parsedHeader = parseHeader(this.lines[line])!

		if (!parsedHeader.dataLocation)
			return this.addToLine(line, data)

		const range = new Range(...parsedHeader.dataLocation.map(e => new Position(line, e)) as [Position, Position])
		const compiledData = compileData({ ...parsedHeader.data, ...data }, this.lines[line].slice(-1)[0] === ' ')

		if (!compiledData)
			this.deleteRange(range)

		this.edits.push({
			method: 'replace',
			range,
			value: compiledData
		})
	}

	private deleteRange (range: Range) {
		this.edits.push({
			method: 'delete',
			range
		})
	}

	private cleanLatex (content: string) {
		let modified = ''

		outer: for (let i = 0; i < content.length; i++) {
			for (const sep of [ '$$', '$' ])
				if (content.slice(i, i + sep.length) === sep) {
					let j = i + sep.length

					while (j < content.length && content.slice(j, j + sep.length) !== sep) j++

					const latexContent = extendLatex(content.slice(i + sep.length, j), this.config.macros ?? [], true)
						.replace( /_(?! )/g, '_ ').replace( /(?<! )_/g, ' _')
						.replace(/\*(?! )/g, '* ').replace(/(?<! )\*/g, ' *')
					
					modified += sep + latexContent + sep

					i = j + sep.length - 1

					continue outer
				}

			modified += content[i]
		}

		return modified
	}

	private static escapeHtml (unsafe: string) {
		return unsafe
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;')
			.replaceAll('"', '&quot;')
	}

	private getHTML (lines: string[]) {
		const rendererLines: string[] = []
		let i = 0

		while (i < lines.length) {
			let content = lines[i]
			let onMathLine = false

			const updateMathLevel = (line: string) => {
				for (let j = 0; j < line.length; j++) {
					const sliced = line.slice(j)

					if (/^\$\$/.test(sliced)) onMathLine = !onMathLine
				}
			}

			updateMathLevel(lines[i])

			i++
            
			while (i < lines.length && onMathLine) {
				content += ' ' + lines[i]
				updateMathLevel(lines[i])
				i++
			}

			let escaped = FileHandler.escapeHtml(this.cleanLatex(content))

			if (escaped.startsWith(' '))
				escaped = '&nbsp;' + escaped.slice(1)

			rendererLines.push(escaped)
		}
        
		return rendererLines.join('<br>')
	}

	private async bindDeck (fileHeaderName: string, question: string): Promise<number | undefined> {
		const opt = await this.ask({
			type: 'closed',
			question,
			options: [ 'Bind to existing deck', 'Create new deck' ]
		})

		if (opt === 'Create new deck') {
			const deckName = await this.ask({
				type: 'open',
				question: 'What do you want your deck name to be ?',
				value: (this.config.relativeDeck ? this.config.relativeDeck + '::' : '') + fileHeaderName.trim(),
				placeholder: 'Deck name'
			})

			if (!deckName)
				return

			if (deckName in this.existingDecks) {
				const opt2 = await this.ask({
					type: 'closed',
					question: 'This deck already exists, what do you want to do ?',
					options: [ 'Bind to this deck', 'Bind to other deck' ]
				})

				if (!opt2)
					return

				if (opt2 === 'Bind to this deck') {
					return this.existingDecks[deckName]
				}

				return await this.bindDeck(fileHeaderName, 'What deck ?')
			}

			const createdDeckId = await createDeck(deckName)

			try {
				showNotification('info', `Deck "${ deckName }" created`)
	
				this.existingDecks = await getDecksWithIds()
				return createdDeckId
			} catch (err) {
				console.error(err)
			}

		}

		if (opt === 'Bind to existing deck') {
			const deckName = await this.ask({
				type: 'closed',
				question: 'What deck ?',
				options: Object.keys(this.existingDecks)
			})

			if (!deckName)
				return

			return this.existingDecks[deckName]
		}
	}

	private async handleFileHeader () {
		if (this.lines.length === 0)
			throw new Error('File is empty')

		const fileHeader = parseHeader(this.lines[0])

		if (!fileHeader || fileHeader.level !== 1)
			throw new Error('File should start with h1')

		if ('id' in fileHeader.data) {
			const id = fileHeader.data.id

			if (typeof id === 'number' && Object.values(this.existingDecks).includes(id)) {
				return id
			} else {
				const deckId = await this.bindDeck(fileHeader.name, 'The id of the current file deck does not exist, what do you want do do ?')

				if (!deckId)
					return
    
				this.modifyLineData(0, { id: deckId })
				this.edit()
				return deckId
			}
		} else {
			const deckId = await this.bindDeck(fileHeader.name, 'This file is not bound to any deck, what do you want to do ?')

			if (!deckId)
				return

			this.modifyLineData(0, { id: deckId })
			this.edit()
			return deckId
		}
	}

	private getAnkiHeaderName (value: string | undefined) {
		return this.config.templateNameAsHeader ? `&lt;h2&gt;${ value!.trim() }&lt;/h2&gt;` : value!
	}

	async handleCards (deckId: number) {
		const deckName = Object.entries(this.existingDecks).find(([, id]) => id === deckId)![0]

		if (!deckName)
			throw new Error()

		const cards: TSCard[] = []
		let i = 1

		const getFields = (card: typeof cards[number]) => Object.fromEntries(fields.map((field, index) => [field, card.fields[index]]))

		const existingCardsIds = await findNotes(deckName)
		const [ existingCards, fields ] = await Promise.all([ getNotesInfo(existingCardsIds), findModel(this.config.template).then(model => model.flds.sort().map(e => e.name)) ])

		const line = () => this.lines[i]

		while (i < this.lines.length && !line()) i++

		while (i < this.lines.length) {
			const headerLine = i
			const header = parseHeader(line())!

            
			i++
            
			const rawContent = []

			while (i < this.lines.length && (!parseHeader(line()) || (parseHeader(line())!.level > header!.level && header.data.group))) {
				rawContent.push(line())
				i++
			}

			if (header?.data.ignore === true)
				continue
			
			const trimmed = trimArray(rawContent)

			if (header.data.table) {
				const n = fields.length
				const matrix = trimmed.map(lineStr => {
					const raw = lineStr.split('|')

					if (raw[0] === '') raw.shift()
					if (raw.length && raw[raw.length - 1] === '') raw.pop()

					return raw.map(e => e.trim())
				})

				if (matrix.length < 3 || !matrix.every(e => e.length === n) || !matrix[1].every(e => /^:?-+:?$/.test(e)) || !fields.every(field => matrix[0].includes(field))) {
					console.log(matrix, fields)
					debugger
					throw new Error()
				}

				const fieldsMap = fields.map(field => matrix[0].indexOf(field))

				const ids = (header.data.ids ?? []) as number[]
				const debounce = createDebounce(16, () => {
					this.modifyLineData(headerLine, { ids })
					this.edit()
				})


				matrix
					.slice(2)
					.forEach((values, lineIndex) => {
						cards.push({
							header: { data: { id: ids[lineIndex] } },
							fields: fieldsMap.map($i => values[$i]).map(parseField(this.config)),
							edit: ({ id }) => {
								ids[lineIndex] = id
								debounce()
							}
						})
					})
			} else {
				cards.push({
					header,
					fields: [ this.getAnkiHeaderName(this.cleanLatex(header.name)), this.getHTML(trimmed) ].map(parseField(this.config)),
					edit: data => this.modifyLineData(headerLine, data)
				})
			}
		}

        
		const unmatchedExistingCards = existingCards.filter(e => e).filter(({ noteId }) => !cards.some(e => e.header?.data.id && typeof e.header.data.id === 'number' && e.header.data.id === noteId))
		const cardsToCreate = cards.filter(e => !e.header?.data.id || !existingCardsIds.includes(e.header.data.id as number))

		if (unmatchedExistingCards.length !== 0) {
			for (const unmatchedCard of unmatchedExistingCards) {
				const sameNameCard = cardsToCreate.find(card => card.fields[0] === unmatchedCard.fields[fields[0]].value)

				if (sameNameCard) {
					cardsToCreate.splice(cardsToCreate.indexOf(sameNameCard), 1)
					sameNameCard.edit({ id: unmatchedCard.noteId })
					continue
				}

                
				const opt = await this.ask({
					type: 'closed',
					question: `The card ${ unmatchedCard.fields[fields[0]].value } does not have a matching header in this file, what do you want to do ?`,
					options: [ 'Bind to unmatched header', 'Create new header with corresponding content' ]
				})

				if (!opt)
					return

				if (opt === 'Create new header with corresponding content') {
					this.addToEnd([ EOL, unmatchedCard.fields[fields[0]].value + ` <!--id: ${ unmatchedCard.noteId }-->`, '', unmatchedCard.fields[fields[1]].value, '' ])
				}

				else if (opt === 'Bind to unmatched header') {
					const header = await this.ask({
						type: 'closed',
						question: 'Which header ?',
						options: cardsToCreate.map(e => e.fields[0])
					})

					if (!header)
						return

					const card = cards.find(e => e.fields[0] === header)!

					cardsToCreate.splice(cardsToCreate.indexOf(card), 1)
					card.edit({ id: unmatchedCard.noteId })
				}
			}

			this.edit()
		}

		if (cardsToCreate.length > 0) {
			const notes = cardsToCreate.map(card => ({
				deckName,
				modelName: this.config.template,
				fields: getFields(card)
			}))

			let ids: (number | null)[] = await createNotes(notes)

			if (ids === null) {
				ids = notes.map(() => null)

				for (let j = 0; j < notes.length; j++) {
					const note = notes[j]
					const id = await createNote(note)

					ids[j] = id
				}
			}

			for (let $i = 0; $i < ids.length; $i++) {
				const id = ids[$i]
				const card = cardsToCreate[$i]
				
				if (id) {
					card.edit({ id })
					showCardUpdatedStatus(card, 'created')
				} else {
					showError(`Card "${ card.fields[0] }" could not be created`)
				}
			}

		}

		this.edit()

        

		for (const card of cards) {
			const existingCard = existingCards.find(e => e.noteId === card.header?.data.id)

			if (!existingCard)
				continue

			if (card.fields.every((value, $i) => existingCard.fields[fields[$i]].value === value))
				continue

			await updateNote({
				id: existingCard.noteId,
				fields: getFields(card)
			})

			showCardUpdatedStatus(card, 'updated')
		}

		this.edit()
	}

	async handle () {
		await syncAnki()
		this.existingDecks = await getDecksWithIds()
		const deckId = await this.handleFileHeader()
        
		if (!deckId) return
        
		await this.handleCards(deckId)
        
		this.edit()
		await syncAnki()

		showNotification('info', 'Everything synced')
	}
}