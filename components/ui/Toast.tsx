'use client';

import { useState, useEffect } from 'react';

type ToastType = 'error' | 'info';

interface ToastMessage {
  id: string;
  text: string;
  type: ToastType;
  timestamp: number;
}

let toastListeners: ((message: ToastMessage) => void)[] = [];

/**
 * Show a toast notification.
 * Toast auto-dismisses after 5 seconds.
 */
export function showToast(text: string, type: ToastType = 'error') {
  const message: ToastMessage = {
    id: crypto.randomUUID(),
    text,
    type,
    timestamp: Date.now(),
  };

  toastListeners.forEach(listener => listener(message));
}

/**
 * Toast notification component.
 * Displays temporary messages that auto-dismiss.
 */
export function Toast() {
  const [message, setMessage] = useState<ToastMessage | null>(null);

  useEffect(() => {
    const listener = (msg: ToastMessage) => setMessage(msg);
    toastListeners.push(listener);

    return () => {
      toastListeners = toastListeners.filter(l => l !== listener);
    };
  }, []);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  if (!message) return null;

  const isInfo = message.type === 'info';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        padding: '0.75rem 1rem',
        backgroundColor: isInfo ? 'var(--bg-elevated)' : 'var(--danger)',
        color: isInfo ? 'var(--text)' : 'var(--bg)',
        border: isInfo ? '1px solid var(--border)' : 'none',
        borderRadius: '0.25rem',
        boxShadow: '0 4px 6px rgba(0, 0, 0, 0.3)',
        zIndex: 9999,
        animation: 'fadeIn 200ms ease-out',
      }}
    >
      {message.text}
    </div>
  );
}
