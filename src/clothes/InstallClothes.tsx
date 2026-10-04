import { useEffect, useState } from 'react';
import { clearInstallPrompt, CLOTHES_URL, getInstallPrompt, isClothesHost, standalone } from './install';

export default function InstallClothes() {
  const [help, setHelp] = useState(false), [copied, setCopied] = useState(false);
  const [prompt, setPrompt] = useState(getInstallPrompt), [installed, setInstalled] = useState(() => isClothesHost() && standalone());
  useEffect(() => {
    const ready = () => setPrompt(getInstallPrompt());
    const done = () => { setInstalled(true); setHelp(false); clearInstallPrompt(); };
    window.addEventListener('bonclothes-install-ready', ready); window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('bonclothes-install-ready', ready); window.removeEventListener('appinstalled', done); };
  }, []);
  if (installed) return null;
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return <div className="clothes-install-control"><button onClick={async () => {
    if (prompt && isClothesHost() && !standalone()) {
      try { await prompt.prompt(); await prompt.userChoice; } finally { clearInstallPrompt(); setPrompt(null); }
    } else setHelp(!help);
  }}>独立安装</button>{help && <div className="clothes-install" role="status">
    <strong>BonClothes</strong>
    <p>{!isClothesHost() || standalone() ? '在浏览器打开独立入口，再添加应用。' : iphone ? 'Safari → 分享 → 添加到主屏幕。' : '在浏览器菜单选择“安装应用”或“添加到主屏幕”。'}</p>
    <div className="clothes-row"><a href={CLOTHES_URL} target="_blank" rel="noreferrer">打开独立入口 ↗</a><button onClick={async () => {
      try { await navigator.clipboard.writeText(CLOTHES_URL); setCopied(true); } catch { setCopied(false); }
    }}>{copied ? '已复制' : '复制地址'}</button><button onClick={() => setHelp(false)}>关闭</button></div>
    <small>clothes.bonbills.cn</small>
  </div>}</div>;
}
