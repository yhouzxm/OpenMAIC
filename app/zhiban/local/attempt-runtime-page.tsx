import React from 'react';
import { createRoot } from 'react-dom/client';
import { AttemptRuntimePanel } from './attempt-runtime-client';
const binding = JSON.parse(document.getElementById('zhiban-runtime-binding')!.textContent!) as {
  base: string;
};
createRoot(document.getElementById('attempt-runtime-root')!).render(
  <AttemptRuntimePanel base={binding.base} publicationId="" />,
);
document
  .getElementById('runtime-return')!
  .addEventListener('click', () =>
    history.length > 1 ? history.back() : location.assign('/zhiban'),
  );
