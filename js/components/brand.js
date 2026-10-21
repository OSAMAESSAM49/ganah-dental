/** Brand mark: the rounded square with the smile, drawn from the clinic logo. */
import { raw } from '../core/dom.js';

/**
 * @param {{ size?: number, variant?: 'violet'|'white'|'lime' }} [opts]
 *   violet: violet square + white smile (default) · white: white square + violet smile ·
 *   lime: lime square + black smile (dark theme accents)
 */
export function brandMark({ size = 46, variant = 'violet' } = {}) {
  const [bg, fg] = { violet: ['#4A0CD3', '#FFFFFF'], white: ['#FFFFFF', '#4A0CD3'], lime: ['#C6FF33', '#000000'] }[variant];
  return raw(`<svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
    <rect width="100" height="100" rx="26" fill="${bg}"/>
    <path d="M24 33v5a26 26 0 0 0 52 0v-5" fill="none" stroke="${fg}" stroke-width="10" stroke-linecap="round"/>
  </svg>`);
}
