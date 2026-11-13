import '@fontsource-variable/manrope';
import './styles/tokens.css';
import './styles/base.css';
import { mount } from 'svelte';
import { applyStoredTheme } from './lib/theme';
import App from './App.svelte';

// The last theme used here, before the first paint (settings load a moment later).
applyStoredTheme();

const app = mount(App, { target: document.getElementById('app')! });

export default app;
