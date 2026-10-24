/* Isolated D08 fixture only; no production route or business authorization. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SlideCanvas } from '@openmaic/renderer';
import {
  applyEditorTransaction,
  createEditorHistory,
  createEditorTransaction,
  undoEditorTransaction,
  redoEditorTransaction,
} from '@openmaic/editor/core';
import type { SlideContent } from '@openmaic/dsl';
const initial = {
  type: 'slide',
  canvas: {
    id: 'slide',
    viewportSize: 960,
    viewportRatio: 0.5625,
    theme: {
      backgroundColor: '#ffffff',
      themeColors: ['#111111'],
      fontColor: '#111111',
      fontName: 'sans-serif',
    },
    background: { type: 'solid', color: '#ffffff' },
    elements: [
      {
        id: 'text',
        type: 'text',
        left: 30,
        top: 30,
        width: 800,
        height: 100,
        rotate: 0,
        content: 'D08 plain text',
        defaultFontName: 'sans-serif',
        defaultColor: '#111111',
      },
    ],
  },
} as SlideContent;
function App() {
  const [history, setHistory] = useState(() => createEditorHistory(initial)),
    [text, setText] = useState('D08 plain text'),
    [status, setStatus] = useState('ready');
  const apply = () => {
    if (!text.isWellFormed() || /[<>&\u0000]/.test(text) || text.length > 2000) {
      setStatus('REJECTED_TEXT');
      return;
    }
    setHistory((h) =>
      applyEditorTransaction(
        h,
        createEditorTransaction({
          origin: 'toolbar',
          operations: [{ type: 'text.updateContent', elementId: 'text', content: text }],
        }),
      ),
    );
    setStatus('APPLIED');
  };
  return (
    <main>
      <h1>D08 isolated public package host</h1>
      <label>
        Plain text
        <textarea aria-label="Plain text" value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <button onClick={apply}>Apply</button>
      <button onClick={() => setHistory(undoEditorTransaction)}>Undo</button>
      <button onClick={() => setHistory(redoEditorTransaction)}>Redo</button>
      <output>{status}</output>
      <pre aria-label="Canonical text">
        {history.present.canvas.elements[0].type === 'text'
          ? history.present.canvas.elements[0].content
          : ''}
      </pre>
      <div style={{ width: 960, height: 540 }}>
        <SlideCanvas slide={history.present.canvas} />
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
