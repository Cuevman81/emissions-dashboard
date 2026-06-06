import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { level, message, context, stack } = body;

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level || 'ERROR',
      message,
      context,
      stack,
    };

    // Store in app_errors.log in the src/logs directory
    const logPath = path.join(process.cwd(), 'src', 'logs', 'app_errors.log');
    
    const line = JSON.stringify(logEntry) + '\n';
    
    fs.appendFileSync(logPath, line, 'utf8');

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to write log:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
