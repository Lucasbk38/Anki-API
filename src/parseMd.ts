import MarkdownIt from 'markdown-it'
import { EOL } from 'os'

const md = new MarkdownIt()

export const parseField = ({ parseMd }: { parseMd: boolean }) => (str: string) =>
	parseMd ? md.render(str.split('<br>').join(EOL), {}) : str