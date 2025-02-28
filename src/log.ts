export const log = (...message: unknown[]) => console.log(`[${ 'AnkiAPI'.cyan }]: `, ...message)
export const logError = (...message: unknown[]) => console.error(`[${ 'AnkiAPI'.red }]: `, ...message)