'use strict';

// These reference values use the same definitions as the 1.1.3 App.
const landmarks = {
  elizabeth: { name: '伦敦钟塔', height: '96', note: '伊丽莎白塔通高' },
  eiffel: { name: '埃菲尔铁塔', height: '330', note: '含天线高度' },
  everest: { name: '珠穆朗玛峰', height: '8,848.86', note: '峰顶雪面海拔' }
};

document.querySelectorAll('[data-landmark]').forEach(button => {
  button.addEventListener('click', () => {
    const key = button.dataset.landmark;
    const reference = landmarks[key];
    document.querySelectorAll('[data-landmark]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    document.querySelectorAll('[data-landmark-art]').forEach(item => { item.toggleAttribute('hidden', item.dataset.landmarkArt !== key); });
    document.querySelector('[data-landmark-name]').textContent = reference.name;
    document.querySelector('[data-landmark-height]').textContent = reference.height;
    document.querySelector('[data-landmark-note]').textContent = reference.note;
  });
});

const tabs = Array.from(document.querySelectorAll('.experience-tab'));
function selectTab(tab, focus = false) {
  tabs.forEach(item => {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
  });
  if (focus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', event => {
    let next;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    selectTab(tabs[next], true);
  });
});
const tabsMedia = window.matchMedia('(max-width: 600px)');
function updateTabOrientation() {
  document.querySelector('.experience-steps').setAttribute('aria-orientation', tabsMedia.matches ? 'horizontal' : 'vertical');
}
updateTabOrientation();
tabsMedia.addEventListener('change', updateTabOrientation);

const qrDialog = document.getElementById('qr-dialog');
const copyStatus = document.getElementById('copy-status');
const copyFallback = document.getElementById('copy-fallback');
let qrTrigger;
document.querySelectorAll('[data-open-qr]').forEach(button => {
  button.addEventListener('click', () => {
    qrTrigger = button;
    copyStatus.textContent = '';
    copyFallback.hidden = true;
    qrDialog.showModal();
  });
});
document.querySelector('[data-close-qr]').addEventListener('click', () => qrDialog.close());
qrDialog.addEventListener('click', event => {
  if (event.target !== qrDialog) return;
  const box = qrDialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) qrDialog.close();
});
qrDialog.addEventListener('close', () => qrTrigger?.focus());
document.getElementById('copy-url').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(copyFallback.value);
    copyStatus.textContent = '链接已复制，可以发送到手机。';
  } catch {
    copyFallback.hidden = false;
    copyFallback.focus();
    copyFallback.select();
    copyStatus.textContent = '请复制上方链接，在手机浏览器打开。';
  }
});
