'use strict';

const titles = {home: '训练首页', climbing: '向上训练', summary: '训练完成'};
const screenNames = {home: '首页', climbing: '运动中', summary: '结算'};
const tabs = Array.from(document.querySelectorAll('[data-screen]'));
const themeButtons = Array.from(document.querySelectorAll('[data-theme-choice]'));
const preview = document.querySelector('[data-preview]');
let screen = 'home';
let theme = 'light';
function renderPreview() {
  preview.src = `assets/site115/${screen}-${theme}.png`;
  preview.alt = `${theme === 'light' ? '浅色' : '深色'}${screenNames[screen]}原生界面，展示演示训练数据`;
  document.querySelector('[data-screen-title]').textContent = titles[screen];
  document.querySelector('[data-screen-counter]').textContent = String(tabs.findIndex(tab => tab.dataset.screen === screen) + 1).padStart(2, '0');
  document.querySelector('.screen-stage').dataset.theme = theme;
  document.getElementById('flow-panel').setAttribute('aria-labelledby', `tab-${screen}`);
  tabs.forEach(tab => {
    const selected = tab.dataset.screen === screen;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  themeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.themeChoice === theme)));
}
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => { screen = tab.dataset.screen; renderPreview(); });
  tab.addEventListener('keydown', event => {
    const offset = {ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1}[event.key];
    let next;
    if (offset) next = (index + offset + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    screen = tabs[next].dataset.screen;
    renderPreview();
    tabs[next].focus();
  });
});
themeButtons.forEach(button => button.addEventListener('click', () => { theme = button.dataset.themeChoice; renderPreview(); }));

const dialog = document.getElementById('qr-dialog');
const copyStatus = document.getElementById('copy-status');
const fallback = document.getElementById('copy-fallback');
let dialogTrigger;
document.querySelectorAll('[data-open-qr]').forEach(button => button.addEventListener('click', () => {
  dialogTrigger = button;
  copyStatus.textContent = '';
  fallback.hidden = true;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else window.open(fallback.value, '_blank', 'noopener,noreferrer');
}));
document.querySelector('[data-close-qr]').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const box = dialog.getBoundingClientRect();
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
});
dialog.addEventListener('close', () => dialogTrigger?.focus());
document.getElementById('copy-url').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(fallback.value);
    copyStatus.textContent = '已复制，在手机浏览器打开即可。';
  } catch {
    fallback.hidden = false;
    fallback.focus();
    fallback.select();
    copyStatus.textContent = '请复制上方链接，在手机浏览器打开。';
  }
});
