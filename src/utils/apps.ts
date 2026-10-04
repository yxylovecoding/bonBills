export const APP_LINKS = {
  bills: { name: 'BonBills', url: 'https://bill.bonbills.cn/', icon: 'bonbills' },
  log: { name: 'BonLog', url: 'https://log.bonbills.cn/', icon: 'bonlife' },
  clothes: { name: 'BonClothes', url: 'https://clothes.bonbills.cn/', icon: 'bonclothes' },
  cv: { name: 'BonCV', url: 'https://cv.bonbills.cn/' },
} as const;
export type AppKind = 'bills' | 'log' | 'clothes';
export function appIdentity(hostname: string, pathname: string) {
  const clothesHost = hostname === 'clothes.bonbills.cn';
  const logHost = hostname === 'log.bonbills.cn' || hostname === 'life.bonbills.cn';
  const kind: AppKind = clothesHost || /^\/clothes(?:\/|$)/.test(pathname) ? 'clothes'
    : logHost || /^\/(?:life|log)(?:\/|$)/.test(pathname) ? 'log' : 'bills';
  const manifest = kind === 'clothes' ? (clothesHost ? '/bonclothes-root.webmanifest' : '/bonclothes.webmanifest')
    : kind === 'log' ? (logHost ? '/bonlog.webmanifest' : /^\/life(?:\/|$)/.test(pathname) ? '/bonlife-path.webmanifest' : '/bonlog-path.webmanifest')
      : '/bonbills.webmanifest';
  return { kind, ...APP_LINKS[kind], manifest };
}
