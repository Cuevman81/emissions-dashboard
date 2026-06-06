'use client';

import { useEffect } from 'react';

/**
 * ErrorLogger component sets up global listeners for client-side errors
 * and sends them to the /api/logs endpoint for persistence.
 */
export default function ErrorLogger() {
  useEffect(() => {
    const logToServer = async (data: { level: string; message: string; stack?: string; context?: any }) => {
      try {
        await fetch('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } catch (e) {
        // Silently fail if we can't even reach the log API
        console.warn('Logging API unreachable:', e);
      }
    };

    const handleError = (event: ErrorEvent) => {
      logToServer({
        level: 'ERROR',
        message: event.message,
        stack: event.error?.stack,
        context: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          url: window.location.href,
        },
      });
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      logToServer({
        level: 'PROMISE_REJECTION',
        message: event.reason?.message || 'Unhandled Promise Rejection',
        stack: event.reason?.stack,
        context: {
          reason: event.reason,
          url: window.location.href,
        },
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);

    // Initial log to confirm system is active
    logToServer({
      level: 'INFO',
      message: 'Dashboard Session Started',
      context: { userAgent: navigator.userAgent, url: window.location.href }
    });

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
    };
  }, []);

  return null; // This component doesn't render anything
}

/**
 * Global helper for manual logging
 */
export async function remoteLog(message: string, level: 'INFO' | 'WARN' | 'ERROR' = 'INFO', context?: any) {
  try {
    await fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message, context }),
    });
  } catch (e) {
    console.warn('Remote logging failed:', e);
  }
}
