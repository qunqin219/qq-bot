import fs = require('fs');
import path = require('path');

const WORKSPACE_DIR = path.resolve(__dirname, '..', '..');
const DEFAULT_ENV_FILE = path.join(WORKSPACE_DIR, '.env');

function parseEnvValue(rawValue: unknown): string {
  let value = String(rawValue || '').trim();
  const quote = value[0];
  if ((quote === '"' || quote === '\'') && value.endsWith(quote)) {
    value = value.slice(1, -1);
    if (quote === '"') {
      value = value
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
    return value;
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function loadEnvFile(filePath: string = process.env.QQ_BOT_ENV_FILE || DEFAULT_ENV_FILE): boolean {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const text = fs.readFileSync(filePath, 'utf-8');
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = parseEnvValue(rawValue);
  }
  return true;
}

loadEnvFile();

module.exports = { loadEnvFile };
