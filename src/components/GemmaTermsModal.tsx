import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import termsText from "../assets/gemma-terms.md?raw";
import "./GemmaTermsModal.css";

const STORAGE_KEY = "gemma-terms-accepted-v1";

export function isGemmaTermsAccepted(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "true";
}

interface Props {
  onAccept: () => void;
  onDecline: () => void;
}

export function GemmaTermsModal({ onAccept, onDecline }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    if (atBottom) setScrolledToBottom(true);
  };

  const handleAccept = () => {
    localStorage.setItem(STORAGE_KEY, "true");
    onAccept();
  };

  return (
    <div className="gemma-terms-overlay" role="dialog" aria-modal="true" aria-labelledby="gemma-terms-title">
      <div className="gemma-terms-modal">
        <div className="gemma-terms-header">
          <div className="gemma-terms-logo">
            <span className="gemma-terms-logo-icon">G</span>
            <span className="gemma-terms-logo-text">Gemma</span>
          </div>
          <h1 id="gemma-terms-title" className="gemma-terms-title">利用規約への同意が必要です</h1>
          <p className="gemma-terms-subtitle">
            Gemma モデルを使用するには、Google の利用規約に同意する必要があります。
          </p>
        </div>

        <div
          className="gemma-terms-body"
          ref={scrollRef}
          onScroll={handleScroll}
          tabIndex={0}
        >
          <div className="gemma-terms-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{termsText}</ReactMarkdown>
          </div>
        </div>

        <div className="gemma-terms-footer">
          {!scrolledToBottom && (
            <p className="gemma-terms-scroll-hint">↓ 規約を最後までスクロールしてください</p>
          )}
          <div className="gemma-terms-actions">
            <button
              className="gemma-terms-btn gemma-terms-btn-decline"
              onClick={onDecline}
            >
              同意しない
            </button>
            <button
              className="gemma-terms-btn gemma-terms-btn-accept"
              onClick={handleAccept}
              disabled={!scrolledToBottom}
            >
              同意する
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
