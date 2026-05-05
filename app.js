const STORAGE_KEY = 'txtav_data_v1';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const GEMINI_MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT = 'Você é um assistente de roteiro audiovisual para vídeos de YouTube de um CEO falando para a câmera. Para cada trecho de fala, sugira UMA inserção audiovisual curta e prática (até 15 palavras). Pode ser corte para imagem, gráfico, texto na tela, B-roll, animação, etc. Responda APENAS com a sugestão, sem aspas e sem explicações.';

let state = {
  rows: [],
  script: '',
  wpm: 150
};

let store = loadStore();

function loadStore() {
  const defaults = { projects: {}, apiKey: '', geminiKey: '', provider: 'gemini' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults;
  } catch {
    return defaults;
  }
}

function saveStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

const $ = id => document.getElementById(id);
const scriptInput = $('script-input');
const wpmInput = $('wpm');
const projectNameInput = $('project-name');
const projectLoad = $('project-load');
const tableSection = $('table-section');
const tbody = $('av-tbody');
const rowCountEl = $('row-count');
const toast = $('toast');

function showToast(msg, ms = 2400) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove('show'), ms);
}

function htmlToPlainText(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  return div.textContent || '';
}

function htmlToPlainTextWithUrls(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('a').forEach(a => {
    const text = a.textContent;
    const href = a.getAttribute('href') || '';
    if (href && text && text.trim() !== href.trim()) {
      a.replaceWith(document.createTextNode(`${text} (${href})`));
    } else if (href) {
      a.replaceWith(document.createTextNode(href));
    }
  });
  div.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
  return div.textContent || '';
}

function htmlForDoc(html) {
  if (!html) return '';
  const div = document.createElement('div');
  div.innerHTML = html;
  div.querySelectorAll('a').forEach(a => {
    if (!a.target) a.setAttribute('target', '_blank');
    if (!a.rel) a.setAttribute('rel', 'noopener');
  });
  return div.innerHTML;
}

function ensureHtml(s) {
  if (!s) return '';
  if (/<[a-z][^>]*>/i.test(s)) return s;
  return escapeHtml(s).replace(/\n/g, '<br>');
}

function plainToHtml(text) {
  return escapeHtml(text || '').replace(/\n/g, '<br>');
}

function countWords(html) {
  return htmlToPlainText(html).trim().split(/\s+/).filter(Boolean).length;
}

function formatTimestamp(seconds) {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function parseParagraphs(text) {
  return text.split(/\n\s*\n+/).map(p => p.trim()).filter(Boolean);
}

function convert() {
  const text = scriptInput.value.trim();
  if (!text) { showToast('Cole o texto antes de converter.'); return; }

  const wpm = parseInt(wpmInput.value, 10) || 150;

  const hasInsertions = state.rows.some(r => htmlToPlainText(r.insertion).trim());
  if (hasInsertions && !confirm('Já existem inserções preenchidas. Converter de novo vai descartá-las. Continuar?')) {
    return;
  }

  const paragraphs = parseParagraphs(text);
  state.script = text;
  state.wpm = wpm;
  state.rows = paragraphs.map(p => ({ text: plainToHtml(p), insertion: '' }));

  render();
  showToast(`${paragraphs.length} parágrafo${paragraphs.length === 1 ? '' : 's'} convertido${paragraphs.length === 1 ? '' : 's'}.`);
}

function computeRowMeta() {
  const wpm = state.wpm || 150;
  let cumSeconds = 0;
  let insertionCount = 0;

  return state.rows.map(row => {
    const timestamp = formatTimestamp(cumSeconds);
    const words = countWords(row.text);
    const duration = (words / wpm) * 60;
    cumSeconds += duration;

    let insertionNumber = '';
    if (htmlToPlainText(row.insertion).trim()) {
      insertionCount++;
      insertionNumber = insertionCount;
    }
    return { timestamp, insertionNumber };
  });
}

function render() {
  if (state.rows.length === 0) {
    tableSection.hidden = true;
    return;
  }
  tableSection.hidden = false;

  const meta = computeRowMeta();
  rowCountEl.textContent = `${state.rows.length} linha${state.rows.length === 1 ? '' : 's'}`;

  tbody.innerHTML = '';
  state.rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="cell-ts">${meta[i].timestamp}</td>
      <td><div class="editable" contenteditable data-field="text" data-i="${i}" data-placeholder="(sem fala)"></div></td>
      <td class="cell-num">${meta[i].insertionNumber}</td>
      <td><div class="editable" contenteditable data-field="insertion" data-i="${i}" data-placeholder="descreva a inserção…"></div></td>
      <td>
        <div class="row-actions">
          <button class="btn-ai" data-act="ai" data-i="${i}" title="Sugerir com IA">✨</button>
          <button class="btn-del" data-act="del" data-i="${i}" title="Apagar linha">🗑</button>
          <button class="btn-add" data-act="add" data-i="${i}" title="Nova linha abaixo">+</button>
        </div>
      </td>
    `;
    tr.querySelector('[data-field=text]').innerHTML = row.text || '';
    tr.querySelector('[data-field=insertion]').innerHTML = row.insertion || '';
    tbody.appendChild(tr);
  });
}

function refreshMetaInDom() {
  const meta = computeRowMeta();
  const trs = tbody.querySelectorAll('tr');
  trs.forEach((tr, idx) => {
    if (!meta[idx]) return;
    tr.querySelector('.cell-ts').textContent = meta[idx].timestamp;
    tr.querySelector('.cell-num').textContent = meta[idx].insertionNumber;
  });
}

tbody.addEventListener('input', e => {
  const el = e.target.closest('.editable');
  if (!el) return;
  const i = parseInt(el.dataset.i, 10);
  const field = el.dataset.field;
  if (!state.rows[i]) return;
  state.rows[i][field] = el.innerHTML;
  refreshMetaInDom();
});

tbody.addEventListener('paste', e => {
  const el = e.target.closest('.editable');
  if (!el) return;
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
});

tbody.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const i = parseInt(btn.dataset.i, 10);
  const act = btn.dataset.act;

  if (act === 'del') {
    if (confirm('Apagar esta linha?')) {
      state.rows.splice(i, 1);
      render();
    }
  } else if (act === 'add') {
    state.rows.splice(i + 1, 0, { text: '', insertion: '' });
    render();
  } else if (act === 'ai') {
    await suggestAI(i, btn);
  }
});

async function suggestAI(i, btn) {
  const provider = store.provider || 'gemini';
  const key = provider === 'gemini' ? store.geminiKey : store.apiKey;
  if (!key) {
    showToast('Configure a chave da API em ⚙ Configurações.');
    return;
  }
  const row = state.rows[i];
  const rowPlain = htmlToPlainText(row && row.text);
  if (!row || !rowPlain.trim()) {
    showToast('Linha sem texto. Escreva um trecho de fala primeiro.');
    return;
  }

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = '…';

  try {
    const fullScript = state.rows
      .map(r => htmlToPlainText(r.text))
      .filter(t => t && t.trim())
      .join('\n\n');
    const suggestion = provider === 'gemini'
      ? await callGemini(fullScript, rowPlain)
      : await callClaude(fullScript, rowPlain);
    state.rows[i].insertion = plainToHtml(suggestion);
    render();
  } catch (err) {
    console.error(err);
    showToast('Erro: ' + (err.message || 'falha ao chamar a IA.'), 4500);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function callClaude(fullScript, paragraph) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': store.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 80,
      system: [
        { type: 'text', text: SYSTEM_PROMPT },
        {
          type: 'text',
          text: `Roteiro completo para contexto:\n\n${fullScript}`,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [{
        role: 'user',
        content: `Trecho específico:\n"${paragraph}"\n\nSugestão de inserção audiovisual:`
      }]
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    let parsed = errText;
    try { parsed = JSON.parse(errText).error?.message || errText; } catch {}
    throw new Error(`HTTP ${res.status}: ${String(parsed).slice(0, 240)}`);
  }
  const data = await res.json();
  return (data.content?.[0]?.text || '').trim() || '(sem resposta)';
}

async function callGemini(fullScript, paragraph) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(store.geminiKey)}`;
  const userPrompt = `Roteiro completo para contexto:\n\n${fullScript}\n\n---\n\nTrecho específico:\n"${paragraph}"\n\nSugestão de inserção audiovisual:`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { maxOutputTokens: 120, temperature: 0.7 }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    let parsed = errText;
    try { parsed = JSON.parse(errText).error?.message || errText; } catch {}
    throw new Error(`HTTP ${res.status}: ${String(parsed).slice(0, 240)}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
  return text.trim() || '(sem resposta)';
}

$('save-btn').addEventListener('click', () => {
  const name = projectNameInput.value.trim();
  if (!name) { showToast('Dê um nome ao projeto antes de salvar.'); return; }
  store.projects[name] = {
    script: scriptInput.value,
    wpm: parseInt(wpmInput.value, 10) || 150,
    rows: state.rows,
    savedAt: new Date().toISOString()
  };
  saveStore();
  refreshProjectList();
  showToast(`Projeto "${name}" salvo.`);
});

$('new-btn').addEventListener('click', () => {
  if (state.rows.length && !confirm('Descartar trabalho atual e começar novo?')) return;
  scriptInput.value = '';
  projectNameInput.value = '';
  state = { rows: [], script: '', wpm: parseInt(wpmInput.value, 10) || 150 };
  render();
});

projectLoad.addEventListener('change', () => {
  const name = projectLoad.value;
  if (!name) return;
  const p = store.projects[name];
  if (!p) return;
  scriptInput.value = p.script || '';
  wpmInput.value = p.wpm || 150;
  projectNameInput.value = name;
  state = {
    rows: (p.rows || []).map(r => ({
      text: ensureHtml(r.text || ''),
      insertion: ensureHtml(r.insertion || '')
    })),
    script: p.script || '',
    wpm: p.wpm || 150
  };
  render();
  projectLoad.value = '';
  showToast(`Projeto "${name}" carregado.`);
});

$('delete-project-btn').addEventListener('click', () => {
  const name = projectNameInput.value.trim();
  if (!name || !store.projects[name]) { showToast('Selecione um projeto salvo pelo nome.'); return; }
  if (!confirm(`Apagar projeto "${name}"?`)) return;
  delete store.projects[name];
  saveStore();
  refreshProjectList();
  showToast(`Projeto "${name}" apagado.`);
});

function refreshProjectList() {
  projectLoad.innerHTML = '<option value="">— selecionar —</option>';
  Object.keys(store.projects).sort().forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    projectLoad.appendChild(opt);
  });
}

const settingsDialog = $('settings-dialog');

function toggleProviderConfig() {
  const p = $('provider').value;
  $('gemini-config').hidden = p !== 'gemini';
  $('claude-config').hidden = p !== 'claude';
}

$('settings-btn').addEventListener('click', () => {
  $('provider').value = store.provider || 'gemini';
  $('gemini-key').value = store.geminiKey || '';
  $('api-key').value = store.apiKey || '';
  toggleProviderConfig();
  settingsDialog.showModal();
});

$('provider').addEventListener('change', toggleProviderConfig);

settingsDialog.addEventListener('close', () => {
  if (settingsDialog.returnValue === 'save') {
    store.provider = $('provider').value;
    store.geminiKey = $('gemini-key').value.trim();
    store.apiKey = $('api-key').value.trim();
    saveStore();
    showToast('Configurações salvas.');
  }
});

$('convert-btn').addEventListener('click', convert);

wpmInput.addEventListener('change', () => {
  state.wpm = parseInt(wpmInput.value, 10) || 150;
  if (state.rows.length) refreshMetaInDom();
});

function buildExportRows() {
  const meta = computeRowMeta();
  return state.rows.map((r, i) => ({
    timestamp: meta[i].timestamp,
    text: r.text,
    num: meta[i].insertionNumber,
    insertion: r.insertion
  }));
}

function exportName() {
  const name = projectNameInput.value.trim() || 'roteiro';
  return name.replace(/[\\/:*?"<>|]/g, '_');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

$('export-xlsx').addEventListener('click', () => {
  if (!state.rows.length) { showToast('Nada para exportar.'); return; }
  const rows = buildExportRows();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Timestamp', 'Fala', '#', 'Inserção audiovisual'],
    ...rows.map(r => [
      r.timestamp,
      htmlToPlainTextWithUrls(r.text),
      r.num,
      htmlToPlainTextWithUrls(r.insertion)
    ])
  ]);
  ws['!cols'] = [{ wch: 10 }, { wch: 60 }, { wch: 5 }, { wch: 50 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Roteiro');
  XLSX.writeFile(wb, `${exportName()}.xlsx`);
});

$('export-pdf').addEventListener('click', () => {
  if (!state.rows.length) { showToast('Nada para exportar.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'landscape' });
  const rows = buildExportRows();
  doc.setFontSize(14);
  doc.text(exportName(), 14, 14);
  doc.autoTable({
    startY: 20,
    head: [['Timestamp', 'Fala', '#', 'Inserção audiovisual']],
    body: rows.map(r => [
      r.timestamp,
      htmlToPlainTextWithUrls(r.text),
      String(r.num),
      htmlToPlainTextWithUrls(r.insertion)
    ]),
    styles: { fontSize: 9, cellPadding: 3, valign: 'top', overflow: 'linebreak' },
    headStyles: { fillColor: [29, 29, 31] },
    columnStyles: {
      0: { cellWidth: 22 },
      1: { cellWidth: 110 },
      2: { cellWidth: 12, halign: 'center' },
      3: { cellWidth: 'auto' }
    }
  });
  doc.save(`${exportName()}.pdf`);
});

$('export-doc').addEventListener('click', () => {
  if (!state.rows.length) { showToast('Nada para exportar.'); return; }
  const rows = buildExportRows();
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${escapeHtml(exportName())}</title></head><body>
<h1 style="font-family:Calibri,sans-serif;">${escapeHtml(exportName())}</h1>
<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;font-family:Calibri,sans-serif;font-size:11pt;width:100%;">
<thead><tr style="background:#eee;">
<th style="width:90px;">Timestamp</th><th>Fala</th><th style="width:40px;">#</th><th>Inserção audiovisual</th>
</tr></thead>
<tbody>
${rows.map(r => `<tr><td>${escapeHtml(r.timestamp)}</td><td>${htmlForDoc(r.text)}</td><td style="text-align:center;">${escapeHtml(r.num)}</td><td>${htmlForDoc(r.insertion)}</td></tr>`).join('')}
</tbody>
</table>
</body></html>`;
  const blob = new Blob(['﻿' + html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${exportName()}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// --- Link dialog (Ctrl+K) ---
const linkDialog = $('link-dialog');
const linkUrl = $('link-url');
const linkRemove = $('link-remove');
let savedRange = null;
let savedEditable = null;

function findLinkInRange(range) {
  const start = range.startContainer;
  const startEl = start.nodeType === 1 ? start : start.parentElement;
  return startEl ? startEl.closest('a') : null;
}

document.addEventListener('keydown', e => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'k') return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const node = sel.anchorNode;
  if (!node) return;
  const startEl = node.nodeType === 1 ? node : node.parentElement;
  if (!startEl) return;
  const editable = startEl.closest('.editable');
  if (!editable) return;

  e.preventDefault();
  const range = sel.getRangeAt(0);
  if (range.collapsed) {
    showToast('Selecione o texto antes de aplicar Ctrl+K.');
    return;
  }
  savedRange = range.cloneRange();
  savedEditable = editable;

  const existing = findLinkInRange(range);
  linkUrl.value = existing ? existing.getAttribute('href') || '' : '';
  linkRemove.hidden = !existing;

  linkDialog.showModal();
  setTimeout(() => { linkUrl.focus(); linkUrl.select(); }, 30);
});

linkUrl.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    linkDialog.close('save');
  }
});

$('link-cancel').addEventListener('click', () => linkDialog.close('cancel'));
linkRemove.addEventListener('click', () => linkDialog.close('remove'));

linkDialog.addEventListener('close', () => {
  const action = linkDialog.returnValue;
  if (!savedRange || !savedEditable || (action !== 'save' && action !== 'remove')) {
    savedRange = null; savedEditable = null;
    return;
  }

  // Restaura a seleção dentro do contenteditable
  savedEditable.focus();
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);

  if (action === 'remove') {
    document.execCommand('unlink');
  } else {
    let url = linkUrl.value.trim();
    if (!url) {
      document.execCommand('unlink');
    } else {
      if (!/^(https?:|mailto:|tel:|#|\/)/i.test(url)) {
        url = 'https://' + url;
      }
      document.execCommand('createLink', false, url);
      savedEditable.querySelectorAll('a').forEach(a => {
        if (!a.target) a.setAttribute('target', '_blank');
        if (!a.rel) a.setAttribute('rel', 'noopener');
      });
    }
  }

  // Persiste no state
  const i = parseInt(savedEditable.dataset.i, 10);
  const field = savedEditable.dataset.field;
  if (state.rows[i]) {
    state.rows[i][field] = savedEditable.innerHTML;
  }

  savedRange = null;
  savedEditable = null;
});

refreshProjectList();
