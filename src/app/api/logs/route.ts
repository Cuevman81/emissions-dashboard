import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const MAX_FIELD_LEN = 2000;      // per-field cap — prevents oversized payloads
const MAX_LOG_BYTES = 5 * 1024 * 1024; // stop appending once the log reaches 5MB

function clip(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v ?? '');
  return s.length > MAX_FIELD_LEN ? s.slice(0, MAX_FIELD_LEN) + '…[truncated]' : s;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { level, message, context, stack } = body;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: typeof level === 'string' ? clip(level).slice(0, 20) : 'ERROR',
      message: clip(message),
      context: clip(context),
      stack: clip(stack),
    };

    // Store in app_errors.log in the src/logs directory
    const logPath = path.join(process.cwd(), 'src', 'logs', 'app_errors.log');

    // Size guard — this is an unauthenticated endpoint; never grow unbounded
    try {
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > MAX_LOG_BYTES) {
        return NextResponse.json({ success: false, error: 'log full' }, { status: 429 });
      }
    } catch { /* stat failure — proceed */ }

    const line = JSON.stringify(logEntry) + '\n';

    fs.appendFileSync(logPath, line, 'utf8');

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to write log:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
