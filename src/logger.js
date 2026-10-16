// Minimal structured (JSON-lines) logger. Hosts like Render collect stdout.
// Never pass secrets, tokens or IP addresses in `fields`.

const LEVELS = new Map([
  ["debug", 10],
  ["info", 20],
  ["warn", 30],
  ["error", 40],
]);

/**
 * @param {{ level?: string, silent?: boolean }} [options]
 * @returns {(level: string, message: string, fields?: object) => void}
 */
export function createLogger({ level = "info", silent = false } = {}) {
  const threshold = LEVELS.get(level) ?? 20;
  return (lvl, message, fields = {}) => {
    if (silent) return;
    const value = LEVELS.get(lvl) ?? 20;
    if (value < threshold) return;
    const line = JSON.stringify({ time: new Date().toISOString(), level: lvl, message, ...fields });
    (value >= 30 ? process.stderr : process.stdout).write(line + "\n");
  };
}
