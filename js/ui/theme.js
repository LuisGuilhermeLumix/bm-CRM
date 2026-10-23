import { emit } from '../state.js';

const KEY = 'lumix.theme';

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

let switchTimer = null;
/** Liga as transições de cor só durante a troca de tema (não interfere em hover/drag). */
function withThemeTransition(fn) {
  const root = document.documentElement;
  root.classList.add('theme-switching');
  fn();
  clearTimeout(switchTimer);
  switchTimer = setTimeout(() => root.classList.remove('theme-switching'), 250);
}

export function setTheme(theme) {
  withThemeTransition(() => document.documentElement.setAttribute('data-theme', theme));
  try { localStorage.setItem(KEY, theme); } catch { /* ignore */ }
  emit('theme', theme);
}

export function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  // O tema já foi aplicado por um script inline no <head> (evita flash).
  // Aqui só acompanhamos mudanças do sistema enquanto o usuário não escolheu.
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  mq.addEventListener?.('change', (e) => {
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
    if (!saved) {
      withThemeTransition(() => document.documentElement.setAttribute('data-theme', e.matches ? 'light' : 'dark'));
      emit('theme');
    }
  });
}
