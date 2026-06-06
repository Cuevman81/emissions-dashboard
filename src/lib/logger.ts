import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(process.cwd(), 'src', 'logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

export function writeLog(filename: string, message: string, options: { truncate?: boolean } = {}) {
  const logPath = path.join(LOG_DIR, filename);
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;

  try {
    if (options.truncate) {
      fs.writeFileSync(logPath, entry, 'utf8');
    } else {
      fs.appendFileSync(logPath, entry, 'utf8');
    }
  } catch (err) {
    console.error(`Failed to write to log file ${filename}:`, err);
  }
}

export function writeJsonLog(filename: string, data: any, options: { truncate?: boolean } = {}) {
  const logPath = path.join(LOG_DIR, filename);
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    ...data
  };

  try {
    const line = JSON.stringify(entry) + '\n';
    if (options.truncate) {
      fs.writeFileSync(logPath, line, 'utf8');
    } else {
      fs.appendFileSync(logPath, line, 'utf8');
    }
  } catch (err) {
    console.error(`Failed to write JSON log to ${filename}:`, err);
  }
}
