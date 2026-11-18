// Upload / remoção da logo de um cliente ou entidade interna (bucket
// "client-logos"). Fonte única: usado no modal de cliente e em Configurações → Empresa.
import { esc } from '../utils.js';
import { confirmDialog } from './dialog.js';
import { toastError, toastSuccess } from './toast.js';
import { LOGO_ACCEPT, uploadClientLogo, removeClientLogo } from '../fin/clients.js';

/** <input type="file"> escondido que o botão da logo dispara. */
export function logoFileInputHtml(attrs = '') {
  return `<input type="file" accept="${LOGO_ACCEPT}" hidden ${attrs} />`;
}

/**
 * Liga os controles da logo.
 *  input      <input type="file">
 *  triggers   elementos que abrem o seletor de arquivo
 *  removeBtn  botão "Remover logo" (opcional)
 *  getClient  () => cliente atual (precisa de id para subir)
 *  onChange   (row) => linha de fin_clients já atualizada
 *  setBusy    (bool) => trava a tela durante o envio (opcional)
 */
export function bindLogoUpload({ input, triggers = [], removeBtn = null, getClient, onChange, setBusy }) {
  triggers.forEach((t) => t.addEventListener('click', () => { if (getClient()?.id) input.click(); }));

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = ''; // permite escolher o mesmo arquivo de novo
    const client = getClient();
    if (!file || !client?.id) return;
    setBusy?.(true);
    try {
      const row = await uploadClientLogo(client.id, file);
      toastSuccess('Logo atualizada.');
      onChange(row);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy?.(false);
    }
  });

  removeBtn?.addEventListener('click', async () => {
    const client = getClient();
    if (!client?.id || !client.logo_url) return;
    const ok = await confirmDialog({
      title: 'Remover logo',
      message: `Remover a logo de "<b>${esc(client.name)}</b>"? Volta a aparecer a inicial do nome.`,
      confirmText: 'Remover',
    });
    if (!ok) return;
    setBusy?.(true);
    try {
      const row = await removeClientLogo(client.id);
      toastSuccess('Logo removida.');
      onChange(row);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy?.(false);
    }
  });
}
