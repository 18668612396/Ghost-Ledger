/** This view can render even if the game entry fails; it never changes a saved run. */
export function showRecovery({ root = document.querySelector('#app'), records = null, download = null } = {}) {
  if (!root || root.dataset.recovery === 'true') return;
  root.dataset.recovery = 'true';
  const section = document.createElement('section'); section.className = 'recovery-screen';
  const title = document.createElement('h1'); title.textContent = '灯火暂时没有接上';
  const copy = document.createElement('p'); copy.textContent = '进度仍在本机。请先导出原始记录，再尝试重新加载。';
  const backup = document.createElement('button'); backup.className = 'secondary-button'; backup.textContent = '导出原始记录';
  const reload = document.createElement('button'); reload.className = 'primary-button'; reload.textContent = '重新加载';
  const content = document.createElement('textarea'); content.className = 'backup-text'; content.hidden = true; content.readOnly = true; content.setAttribute('aria-label', '原始记录内容');
  backup.addEventListener('click', () => {
    let saved = records;
    if (!saved) {
      saved = {};
      try { for (const key of Object.keys(localStorage)) if (key.startsWith('ghost-ledger.')) saved[key] = localStorage.getItem(key); } catch {}
    }
    const text = JSON.stringify({ format: 'ghost-ledger.raw-records', version: 1, records: saved }, null, 2);
    content.value = text; content.hidden = false;
    if (download) download(text, 'ghost-ledger-recovery.json');
    else try { const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = 'ghost-ledger-recovery.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch {}
  });
  reload.addEventListener('click', () => window.location.reload());
  section.append(title, copy, backup, reload, content); root.replaceChildren(section);
}
