import { useEffect, useState } from 'react';
import { clearInstallPrompt, getInstallPrompt, standalone } from '../utils/appInstall';
import { APP_LINKS, type AppKind } from '../utils/apps';
import './installApp.css';

export default function InstallApp({ app }: { app: AppKind }) {
  const { name, url } = APP_LINKS[app], hostname = new URL(url).hostname;
  const ownHost = window.location.hostname === hostname;
  const [help, setHelp] = useState(false), [copied, setCopied] = useState(false);
  const [prompt, setPrompt] = useState(getInstallPrompt), [installed, setInstalled] = useState(() => ownHost && standalone());
  useEffect(() => {
    const ready = () => setPrompt(getInstallPrompt());
    const done = () => { setInstalled(true); setHelp(false); clearInstallPrompt(); };
    window.addEventListener('bon-install-ready', ready); window.addEventListener('appinstalled', done);
    return () => { window.removeEventListener('bon-install-ready', ready); window.removeEventListener('appinstalled', done); };
  }, []);
  if (installed) return null;
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return <div className="app-install-control"><button onClick={async () => {
    if (prompt && ownHost && !standalone()) {
      try { await prompt.prompt(); await prompt.userChoice; } catch { setHelp(true); }
      finally { clearInstallPrompt(); setPrompt(null); }
    } else setHelp(!help);
  }}>独立安装</button>{help && <div className="app-install-help" role="status">
    <strong>{name}</strong>
    <p>{!ownHost || standalone() ? '在浏览器打开独立入口，再添加应用。' : iphone ? 'Safari → 分享 → 添加到主屏幕。' : '在浏览器菜单选择“安装应用”或“添加到主屏幕”。'}</p>
    <div className="app-install-actions"><a href={url} target="_blank" rel="noreferrer">打开独立入口 ↗</a><button onClick={async () => {
      try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
    }}>{copied ? '已复制' : '复制地址'}</button><button onClick={() => setHelp(false)}>关闭</button></div>
    <small>{hostname}</small>
  </div>}</div>;
}
