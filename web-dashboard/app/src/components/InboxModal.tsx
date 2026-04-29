// InboxModal.tsx - Cmd+J quick add a URL to the queue.
//
// Mirrors the slash-mode equivalent: paste a URL, hit enter, the row appears
// in data/pipeline.md as Pending. Bypasses title_filter — if the user typed
// it, they want it. Metadata (title, location) is fetched best-effort from
// the ATS API on the server when possible.

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import './InboxModal.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; row: string }
  | { kind: 'error'; message: string };

export function InboxModal({ open, onClose }: Props) {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset state on open and autofocus.
  useEffect(() => {
    if (!open) return;
    setUrl('');
    setStatus({ kind: 'idle' });
    queueMicrotask(() => inputRef.current?.focus());
  }, [open]);

  const addMutation = useMutation({
    mutationFn: (input: string) => api.addInboxUrl(input),
    onSuccess: (data) => {
      setStatus({ kind: 'success', row: data.row });
      qc.invalidateQueries({ queryKey: ['pipeline'] });
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({
        kind: 'error',
        message: humanizeError(message),
      });
    },
  });

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setStatus({ kind: 'submitting' });
    addMutation.mutate(trimmed);
  };

  // Esc to close (when not actively submitting).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (status.kind === 'submitting') return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, status.kind]);

  if (!open) return null;

  const valid = isLikelyUrl(url);

  return (
    <div
      className="inbox-modal__backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        if (status.kind === 'submitting') return;
        onClose();
      }}
    >
      <div
        className="inbox-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inbox-modal-title"
      >
        <header className="inbox-modal__head">
          <span className="eyebrow">add to queue</span>
          <h2 id="inbox-modal-title" className="inbox-modal__title">
            Quick add URL
          </h2>
        </header>
        <p className="inbox-modal__help">
          Paste a job URL. It lands in <code>data/pipeline.md</code> as a
          Pending row, ready to evaluate. Bypasses title-filter rules.
        </p>

        <form
          className="inbox-modal__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && status.kind !== 'submitting') submit();
          }}
        >
          <input
            ref={inputRef}
            className="inbox-modal__input mono"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://jobs.ashbyhq.com/…"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (status.kind === 'error') setStatus({ kind: 'idle' });
            }}
            disabled={status.kind === 'submitting'}
          />

          <div className="inbox-modal__feedback" aria-live="polite">
            {status.kind === 'submitting' ? (
              <span className="inbox-modal__feedback-line mono">
                Adding…
              </span>
            ) : status.kind === 'success' ? (
              <span className="inbox-modal__feedback-line inbox-modal__feedback-line--ok mono">
                Added · {previewRow(status.row)}
              </span>
            ) : status.kind === 'error' ? (
              <span className="inbox-modal__feedback-line inbox-modal__feedback-line--err mono">
                {status.message}
              </span>
            ) : (
              <span className="inbox-modal__feedback-line inbox-modal__feedback-line--hint mono">
                Press ↵ to add · Esc to close
              </span>
            )}
          </div>

          <footer className="inbox-modal__foot">
            <button
              type="button"
              className="inbox-modal__btn"
              onClick={onClose}
              disabled={status.kind === 'submitting'}
            >
              {status.kind === 'success' ? 'done' : 'cancel'}
            </button>
            <button
              type="submit"
              className="inbox-modal__btn inbox-modal__btn--primary"
              disabled={!valid || status.kind === 'submitting'}
            >
              {status.kind === 'submitting' ? 'adding…' : 'add'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function isLikelyUrl(s: string): boolean {
  const trimmed = s.trim();
  return /^https?:\/\/\S+\.\S+/i.test(trimmed);
}

function humanizeError(msg: string): string {
  // The API returns errors like "/api/inbox/add: 409 {\"error\":\"URL already in pipeline\"}"
  const match = msg.match(/(\d{3})\s+(.+)$/);
  if (!match) return msg;
  const [, code, rest] = match;
  try {
    const parsed = JSON.parse(rest);
    if (parsed?.error) return `${code} · ${parsed.error}`;
  } catch {
    // not json — fall through
  }
  return `${code} · ${rest}`;
}

function previewRow(row: string): string {
  // Strip the leading "- [ ] " checkbox marker and trim long URLs in the
  // preview so the toast stays readable.
  const m = row.match(/^- \[ \]\s+(\S+)\s*\|\s*(.+)$/);
  if (!m) return row;
  const url = m[1];
  const tail = m[2];
  const shortUrl = url.length > 40 ? url.slice(0, 37) + '…' : url;
  return `${shortUrl} · ${tail}`;
}
