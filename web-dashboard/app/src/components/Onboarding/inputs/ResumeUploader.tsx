// ResumeUploader.tsx -- file dropzone + paste-text fallback for StepCV.
//
// Drop or browse: .pdf .docx .txt .md, capped at 10 MB to match the server.
// Paste fallback: a mono textarea below a horizontal rule. The same submit
// button handles both: if there's a file it uploads, else it sends the
// pasted text. The component is stateless about which one is "active";
// the parent (StepCV) decides based on phase.

import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';

interface Props {
  /** disabled while parsing; renders the dropzone in a non-interactive style */
  disabled?: boolean;
  pastedText: string;
  onPastedTextChange: (text: string) => void;
  onFile: (file: File) => void;
  onSubmitText: () => void;
}

const ACCEPT = '.pdf,.docx,.txt,.md';
const MAX_BYTES = 10 * 1024 * 1024;

export function ResumeUploader({
  disabled,
  pastedText,
  onPastedTextChange,
  onFile,
  onSubmitText,
}: Props) {
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const accept = (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError('file is too large · max 10 MB');
      return;
    }
    onFile(file);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setHover(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) accept(file);
  };

  const onChangeFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) accept(file);
    // Reset so the same file can be re-selected if the parse failed.
    e.target.value = '';
  };

  return (
    <div className="onb-uploader">
      <div
        className={`onb-dropzone${hover ? ' onb-dropzone--hover' : ''}${
          disabled ? ' onb-dim' : ''
        }`}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-label="Drop your resume or click to browse"
        aria-disabled={disabled || undefined}
        onClick={() => !disabled && fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled) {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        onDragEnter={() => !disabled && setHover(true)}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setHover(true);
        }}
        onDragLeave={() => setHover(false)}
        onDrop={onDrop}
      >
        <div className="onb-dropzone__title">drop your resume here</div>
        <div className="onb-dropzone__hint">or click to browse</div>
        <div className="onb-dropzone__formats">pdf · docx · txt · md</div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={onChangeFile}
          disabled={disabled}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>
      {error ? <p className="onb-error">{error}</p> : null}

      <div className="onb-or" aria-hidden>
        <span className="onb-or__line" />
        <span className="onb-or__label">or paste text</span>
        <span className="onb-or__line" />
      </div>

      <textarea
        className="onb-textarea onb-textarea--mono"
        rows={8}
        placeholder="Paste your résumé text here. The system will structure it into the canonical CV shape."
        value={pastedText}
        onChange={(e) => onPastedTextChange(e.target.value)}
        disabled={disabled}
        aria-label="Paste resume text"
      />
      <div className="onb-uploader__paste-actions">
        <span className="onb-help">
          # paste fallback works without a parser if claude is offline
        </span>
        <button
          type="button"
          className="onb-btn onb-btn--primary"
          disabled={disabled || pastedText.trim().length < 200}
          onClick={onSubmitText}
        >
          parse pasted text
        </button>
      </div>
    </div>
  );
}
