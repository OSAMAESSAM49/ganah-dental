/** Switching between Arabic and English: saved on the signed-in user (and on this device). */
import { repos } from '../data/index.js';
import { currentUser } from '../core/session.js';
import { lang, rememberLanguage } from '../core/i18n.js';

export const otherLanguage = () => (lang() === 'en' ? 'ar' : 'en');

/** Saves the choice and reloads the app in that language (the session is restored from the user). */
export async function switchLanguage(to = otherLanguage()) {
  const user = currentUser();
  if (user) await repos.users.update(user.id, { lang: to });
  rememberLanguage(to);
  location.reload();
}
