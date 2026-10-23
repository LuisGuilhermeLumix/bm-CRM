// Tela de login / esqueci a senha / definir nova senha
import { icon, refreshIcons } from './icons.js';
import { esc } from '../utils.js';
import { signIn, resetPassword, updatePassword } from '../auth.js';
import { currentTheme, toggleTheme } from './theme.js';
import { toastSuccess } from './toast.js';

export function renderLogin(host, { mode = 'login', onRecovered } = {}) {
  const subtitle = {
    login: 'Entre com seu e-mail e senha',
    reset: 'Enviaremos um link para redefinir a senha',
    recovery: 'Defina sua nova senha',
  }[mode];

  host.innerHTML = `
    <div class="login">
      <button class="btn btn--ghost btn--icon login__theme" id="loginTheme" title="Alternar tema">${icon(currentTheme() === 'dark' ? 'sun' : 'moon')}</button>
      <div class="login__card">
        <div class="login__brand">
          <span class="brand__logo">${icon('kanban')}</span>
          <div><h1>Lumix CRM</h1><p>${esc(subtitle)}</p></div>
        </div>
        <form id="loginForm" novalidate>
          ${mode !== 'recovery' ? `
            <div class="form-field">
              <label for="email">E-mail</label>
              <input class="input" id="email" type="email" autocomplete="email" required placeholder="voce@lumix.com" />
            </div>` : ''}
          ${mode === 'login' ? `
            <div class="form-field">
              <label for="password">Senha</label>
              <input class="input" id="password" type="password" autocomplete="current-password" required placeholder="••••••••" />
            </div>` : ''}
          ${mode === 'recovery' ? `
            <div class="form-field">
              <label for="password">Nova senha</label>
              <input class="input" id="password" type="password" autocomplete="new-password" required minlength="6" placeholder="mínimo 6 caracteres" />
            </div>
            <div class="form-field">
              <label for="password2">Confirmar senha</label>
              <input class="input" id="password2" type="password" autocomplete="new-password" required minlength="6" />
            </div>` : ''}
          <div class="login__error hidden" id="loginError">${icon('circle-alert')}<span></span></div>
          <button class="btn btn--primary btn--block" id="loginSubmit" type="submit">
            ${{ login: 'Entrar', reset: 'Enviar link', recovery: 'Salvar nova senha' }[mode]}
          </button>
          <div class="login__links">
            ${mode === 'login' ? '<a href="#" id="linkReset">Esqueci a senha</a><span class="subtle">Acesso restrito</span>' : ''}
            ${mode === 'reset' ? '<a href="#" id="linkBack">Voltar para o login</a>' : ''}
            ${mode === 'recovery' ? '<a href="#" id="linkBack">Cancelar</a>' : ''}
          </div>
        </form>
      </div>
    </div>`;
  refreshIcons();

  const form = host.querySelector('#loginForm');
  const errBox = host.querySelector('#loginError');
  const submit = host.querySelector('#loginSubmit');
  const showError = (msg) => { errBox.querySelector('span').textContent = msg; errBox.classList.remove('hidden'); };
  const busy = (b) => { submit.disabled = b; submit.innerHTML = b ? `${icon('loader-circle', 'spin')} Aguarde…` : submit.dataset.label; refreshIcons(); };
  submit.dataset.label = submit.innerHTML;

  host.querySelector('#loginTheme').addEventListener('click', () => {
    toggleTheme();
    host.querySelector('#loginTheme').innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon');
    refreshIcons();
  });
  host.querySelector('#linkReset')?.addEventListener('click', (e) => { e.preventDefault(); renderLogin(host, { mode: 'reset', onRecovered }); });
  host.querySelector('#linkBack')?.addEventListener('click', (e) => { e.preventDefault(); renderLogin(host, { mode: 'login', onRecovered }); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    const email = host.querySelector('#email')?.value.trim();
    const password = host.querySelector('#password')?.value;
    try {
      if (mode === 'login') {
        if (!email || !password) return showError('Preencha e-mail e senha.');
        busy(true);
        await signIn(email, password); // onAuthStateChange cuida do resto
      } else if (mode === 'reset') {
        if (!email) return showError('Informe seu e-mail.');
        busy(true);
        await resetPassword(email);
        toastSuccess('Se o e-mail existir, você receberá um link para redefinir a senha.');
        renderLogin(host, { mode: 'login', onRecovered });
      } else if (mode === 'recovery') {
        const p2 = host.querySelector('#password2').value;
        if (!password || password.length < 6) return showError('A senha precisa ter pelo menos 6 caracteres.');
        if (password !== p2) return showError('As senhas não conferem.');
        busy(true);
        await updatePassword(password);
        toastSuccess('Senha atualizada.');
        onRecovered?.();
      }
    } catch (err) {
      busy(false);
      showError(err.message || 'Algo deu errado.');
    }
  });

  setTimeout(() => host.querySelector('input')?.focus(), 30);
}

export function renderSetup(host) {
  host.innerHTML = `
    <div class="login">
      <div class="login__card setup-box">
        <div class="login__brand">
          <span class="brand__logo">${icon('kanban')}</span>
          <div><h1>Lumix CRM</h1><p>Configuração pendente</p></div>
        </div>
        <p class="muted">O arquivo <code>js/config.js</code> ainda está com os valores de exemplo.</p>
        <p class="muted">Copie <code>js/config.example.js</code> para <code>js/config.js</code> e preencha <code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code> (Supabase → Project Settings → API). Depois recarregue a página.</p>
      </div>
    </div>`;
  refreshIcons();
}

/** Usuário autenticado, mas sem acesso ao CRM (profiles.allowed = false). */
export function renderNoAccess(host, { email = '', onSignOut } = {}) {
  host.innerHTML = `
    <div class="login">
      <div class="login__card setup-box">
        <div class="login__brand">
          <span class="brand__logo">${icon('lock')}</span>
          <div><h1>Lumix CRM</h1><p>Acesso não liberado</p></div>
        </div>
        <p class="muted">A conta <b>${esc(email)}</b> existe, mas ainda não foi liberada para este CRM.</p>
        <p class="muted">Peça a quem administra o Supabase para marcar <code>allowed = true</code> no seu perfil (tabela <code>profiles</code>) e entre de novo.</p>
        <button class="btn btn--block" id="noAccessOut">${icon('log-out')} Sair</button>
      </div>
    </div>`;
  refreshIcons();
  host.querySelector('#noAccessOut').addEventListener('click', () => onSignOut?.());
}
