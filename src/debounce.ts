export const createDebounce = <T extends Array<unknown>> (delay: number, cb: ((...args: T) => void)) => {
	let timeout: NodeJS.Timeout
    
	return (...args: T) => {
		clearTimeout(timeout)

		timeout = setTimeout(() => cb(...args), delay)
	}
}