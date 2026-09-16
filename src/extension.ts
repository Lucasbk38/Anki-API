// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { Asker, configFileName, extendLatex, FileHandler, getConfig, Macro, RecoverOptions, ToEdit } from './index'
import { log, logError } from './log'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'

import MarkdownIt from 'markdown-it'
import path from 'path'

import * as vscode from 'vscode'



let lastActiveMarkdownUri: vscode.Uri | undefined

/**
 * Keep track of the last active markdown editor's URI.
 * This is updated whenever the active editor changes and its languageId === 'markdown'.
 */
const setupActiveEditorTracker = (context: vscode.ExtensionContext) => {
	// initialize from current active editor if it is markdown
	if (vscode.window.activeTextEditor?.document?.languageId === 'markdown') {
		lastActiveMarkdownUri = vscode.window.activeTextEditor.document.uri
	}

	const disposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (!editor) return
		try {
			if (editor.document && editor.document.languageId === 'markdown') {
				lastActiveMarkdownUri = editor.document.uri
			}
		} catch (e) {
			// ignore
		}
	})

	context.subscriptions.push(disposable)
}

export const showError = async <R> (message: string, recoverOptions: RecoverOptions<R> = []) => {
	const opt = await vscode.window.showErrorMessage(message, ...recoverOptions.map(e => e.name))

	if (!opt)
		return

	return await recoverOptions.find(e => e.name === opt)!.callback()
}

export const showNotification = (type: 'info' | 'warning' | 'error', message: string, options: string[] = []) =>
	vscode.window[({ info: 'showInformationMessage', error: 'showErrorMessage', warning: 'showWarningMessage' } as const)[type]](message, ...options)

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export const activate = async (context: vscode.ExtensionContext) => {
	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	log('Congratulations, your extension "ankiapi" is now active!')

	setupActiveEditorTracker(context)

	
	const ask = async <S extends string>(questionData: Asker<S>) => {
		if (questionData.type === 'closed')
			return await vscode.window.showQuickPick(questionData.options, {
				title: questionData.question
			}) as S
		else if (questionData.type === 'open')
			return await vscode.window.showInputBox({
				title: questionData.question,
				placeHolder: questionData.placeholder,
				value: questionData.value
			}) as S
	}

	const makeEdits = (edits: ToEdit[], textEditor = vscode.window.activeTextEditor!) => textEditor.edit(editor => {
		for (const modif of edits) {
			if (modif.method === 'insert')
				editor.insert(modif.position, modif.value)

			else if (modif.method === 'delete')
				editor.delete(modif.range)

			else if (modif.method === 'replace')
				editor.replace(modif.range, modif.value)
		}
	})

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	const disposable = vscode.commands.registerTextEditorCommand('ankiapi.syncFile', async () => {
		try {
			const activeTextEditor = vscode.window.activeTextEditor!
	
			if (!activeTextEditor.document || !activeTextEditor.document.fileName.endsWith('.md')) {
				throw new Error('To run Anki API, you have to open a .md file')
			}
			
			const config = await getConfig(activeTextEditor.document.fileName, ask)

			if (!config)
				return
			
			const fileHandler = new FileHandler(
				activeTextEditor.document.getText(),
				config,
				makeEdits,
				ask
			)

			await fileHandler.handle()
		} catch (err) {
			logError(err)

			if (err instanceof Error) {
				if ('recoverOptions' in err) {
					showError(err.message, err.recoverOptions as RecoverOptions<unknown>)
				} else {
					await vscode.window.showErrorMessage(err.message)
				}
			}

			else if (typeof err === 'string')
				await vscode.window.showErrorMessage(err)
		}

		log('Done'.green)
	})

	context.subscriptions.push(disposable)


	const configs: Record<string, unknown> = {}

	const getParents = (dir: string): string[] => {
		const parent = path.dirname(dir)

		if (dir === parent)
			return [dir]

		return [dir].concat(getParents(parent))
	}
	
	const addDocToConfig = async (doc: vscode.TextDocument) => {
		if (doc.isUntitled || !(doc.fileName.endsWith('.md') || doc.fileName.endsWith(configFileName)))
			return

		const promises: Promise<void>[] = []

		for (const dir of getParents(path.dirname(doc.fileName))) {
			const configFile = path.join(dir, configFileName)

			if (!existsSync(configFile))
				continue

			promises.push(readFile(configFile)
				.then(e => JSON.parse(e.toString()))
				.then(content => (configs[dir] = content)))
		}
			
		await Promise.all(promises)
	}

	await Promise.all(vscode.workspace.textDocuments.map(addDocToConfig))
	vscode.workspace.onDidOpenTextDocument(addDocToConfig)
	vscode.workspace.onDidSaveTextDocument(addDocToConfig)


	return {
		extendMarkdownIt (md: MarkdownIt) {
			// Règle core : parcourt les tokens et modifie les tokens de type contenant 'math'
			md.core.ruler.push('ankiapi_color_math', state => {
				if (!lastActiveMarkdownUri)
					return false

				const macros = getParents(lastActiveMarkdownUri.fsPath)
					.map(k => configs[k])
					.filter(e => typeof e === 'object' && e !== null && 'macros' in e)
					.map(e => e.macros as Macro[])
					.flat()
					.reduce((g, c) => g.some(e => e.name === c.name) ? g : g.concat([c]), [] as Macro[])

				const parseTokens = (tokens: typeof state.tokens) => {
					for (const token of tokens) {
						if (!token) continue

						// token.type peut être 'math_inline', 'math_block', etc. -> recherche 'math'
						if (token.type && token.type.toLowerCase().includes('math'))
							if (typeof token.content === 'string')
								token.content = extendLatex(token.content, macros, false)

						// certains tokens (inline) ont des children où se trouvent les math inline
						if (token.children && Array.isArray(token.children) && token.children.length)
							parseTokens(token.children)
					}
				}

				parseTokens(state.tokens)
				
				return true
			})

			return md
		}
	}
}

// This method is called when your extension is deactivated
export const deactivate = () => {}
