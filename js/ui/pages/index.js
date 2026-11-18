// Registro das seções (menos Boards, que é o kanban em #board).
// Cada módulo exporta mount(container) e unmount().
import * as dashboard from './dashboard.js';
import * as clientes from './clientes.js';
import * as financeiro from './financeiro.js';
import * as distribuicao from './distribuicao.js';
import * as credenciais from './credenciais.js';
import * as anotacoes from './anotacoes.js';
import * as relatorios from './relatorios.js';
import * as config from './config.js';

export const PAGES = { dashboard, clientes, financeiro, distribuicao, credenciais, anotacoes, relatorios, config };
