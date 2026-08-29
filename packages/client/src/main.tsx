import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Fonts are bundled locally - nothing is fetched from Google at runtime
// (spec section 41).
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/screens.css';

import { App } from './App.js';
import { sound } from './lib/sound.js';

sound.loadPreference();

// Audio contexts need a user gesture; arm it on the first interaction.
const arm = () => {
  sound.unlock();
  window.removeEventListener('pointerdown', arm);
  window.removeEventListener('keydown', arm);
};
window.addEventListener('pointerdown', arm);
window.addEventListener('keydown', arm);

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
