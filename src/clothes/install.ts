export interface InstallPrompt extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let pending: InstallPrompt | null = null;
// Capture before lazy loading or session restoration; browsers may dispatch only once.
window.addEventListener('beforeinstallprompt', (event) => {
  if (!location.hostname.startsWith('clothes.') && !/^\/clothes(?:\/|$)/.test(location.pathname)) return;
  event.preventDefault(); pending = event as InstallPrompt;
  window.dispatchEvent(new Event('bonclothes-install-ready'));
});
export function getInstallPrompt() { return pending; }
export function clearInstallPrompt() { pending = null; }
export const CLOTHES_URL = 'https://clothes.bonbills.cn/';
export const isClothesHost = () => window.location.hostname === 'clothes.bonbills.cn';
export const standalone = () => window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
