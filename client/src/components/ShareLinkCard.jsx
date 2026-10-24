import { useState } from 'react';
import { Button, Card } from './ui.jsx';

/**
 * Shows a one-time link with Copy and WhatsApp buttons. Used for invitation links and
 * owner-assisted password-reset links. The link is held only in this component's state, so once
 * dismissed it is gone for good (the server keeps just a hash and cannot show it again).
 */
export function ShareLinkCard({ title, intro, url, shareText, onDismiss }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      document.getElementById('share-link')?.select(); // clipboard blocked: select it so Ctrl+C works
    }
  }

  return (
    <Card title={title} className="mt-6 border-emerald-200 bg-emerald-50">
      <p className="text-sm text-slate-700">{intro}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          id="share-link"
          readOnly
          value={url}
          aria-label="Link"
          onFocus={(e) => e.target.select()}
          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <Button onClick={copy}>{copied ? 'Copied' : 'Copy link'}</Button>
        <Button variant="secondary" to={`https://wa.me/?text=${encodeURIComponent(`${shareText} ${url}`)}`} target="_blank" rel="noopener noreferrer">
          Share on WhatsApp
        </Button>
        <Button variant="secondary" onClick={onDismiss}>Done</Button>
      </div>
    </Card>
  );
}
