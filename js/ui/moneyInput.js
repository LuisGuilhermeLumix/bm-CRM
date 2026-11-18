// Campo de valor em reais com máscara: digita só os números e os centavos
// entram da direita para a esquerda ("123456" → "1.234,56").
import { esc, onlyDigits } from '../utils.js';

const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MAX_DIGITS = 12; // numeric(12,2)

const centsToText = (digits) => fmt.format(Number(digits || 0) / 100);
const numberToDigits = (n) => String(Math.round(Math.abs(Number(n) || 0) * 100));

export function moneyInputHtml({ id, value = 0, label = 'Valor em reais' }) {
  return `<div class="money">
    <span class="money__prefix">R$</span>
    <input class="input" id="${esc(id)}" inputmode="numeric" autocomplete="off" aria-label="${esc(label)}" value="${centsToText(numberToDigits(value))}" />
  </div>`;
}

export function bindMoneyInput(input) {
  const apply = () => {
    input.value = centsToText(onlyDigits(input.value).replace(/^0+/, '').slice(0, MAX_DIGITS));
    input.setSelectionRange(input.value.length, input.value.length);
  };
  input.addEventListener('input', apply);
  input.addEventListener('focus', () => setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0));
}

/** Valor numérico do campo (ex.: 1234.56). */
export function moneyValue(input) {
  return Number(onlyDigits(input.value) || 0) / 100;
}
