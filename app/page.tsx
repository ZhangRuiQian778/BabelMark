"use client";
import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { languages } from '../lib/languages';
import { t } from '../lib/i18n';
import { downloadText, storage } from '../lib/utils';
import { applyTranslations, segmentMarkdown, toMarkdownString } from '../lib/segmenter';
import type { ApiTranslateRequest, AppSettings, TranslateProgress } from '../lib/types';
import { CirclePlay, Square, Copy, Download, FileArchive, Plus, X } from 'lucide-react';
import { franc } from 'franc-min';
import * as Toast from '@radix-ui/react-toast';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

const SETTINGS_KEY = 'babelmark_settings_v1';

const DEFAULT_SETTINGS: AppSettings = {
  targetLang: 'en',
  model: 'gpt-4o-mini',
  uiLang: 'en',
  apiKey: undefined,
  apiBase: undefined,
  options: {
    translateLinkText: true,
    translateImageAlt: false,
    preserveEmptyLines: true,
    spellcheck: true,
    punctuationLocale: undefined,
  },
  glossary: [],
  protectedTerms: [],
  concurrency: 3,
};

export default function Page() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [source, setSource] = useState<string>('');
  const [translatedMd, setTranslatedMd] = useState<string>('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState<TranslateProgress>({ byId: {}, done: {}, errors: {} });
  const [segCtx, setSegCtx] = useState<any | null>(null);
  const [detected, setDetected] = useState<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const [glossSource, setGlossSource] = useState<string>('');
  const [glossTarget, setGlossTarget] = useState<string>('');
  const [protInput, setProtInput] = useState<string>('');
  const [toastOpen, setToastOpen] = useState(false);
  const [toastTitle, setToastTitle] = useState('');
  const [toastDesc, setToastDesc] = useState('');

  useEffect(() => {
    const s = storage.get<AppSettings>(SETTINGS_KEY, DEFAULT_SETTINGS);
    // Merge defaults to support config migrations (e.g., new fields like concurrency)
    setSettings({ ...DEFAULT_SETTINGS, ...s });
  }, []);

  useEffect(() => {
    storage.set(SETTINGS_KEY, settings);
  }, [settings]);

  useEffect(() => {
    if (!source) { setDetected(''); return; }
    try {
      const iso3 = franc(source.slice(0, 2000));
      setDetected(iso3);
    } catch { setDetected(''); }
  }, [source]);

  function showToast(title: string, desc: string) {
    setToastTitle(title);
    setToastDesc(desc);
    setToastOpen(false);
    // ensure re-open animation
    setTimeout(() => setToastOpen(true), 0);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // shortcuts: Ctrl/Cmd+Enter start/stop, Ctrl/Cmd+C copy, Ctrl/Cmd+Shift+S download, Ctrl/Cmd+Shift+E export zip
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'enter') {
          e.preventDefault();
          isTranslating ? stop() : start();
        } else if (k === 'c') {
          e.preventDefault();
          onCopy();
        } else if (e.shiftKey && k === 's') {
          e.preventDefault();
          onDownload();
        } else if (e.shiftKey && k === 'e') {
          e.preventDefault();
          onExportZip();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isTranslating, source, translatedMd, settings]);

  const ui = settings.uiLang;

  async function handleDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) {
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith('.md')) {
        const text = await file.text();
        setSource(text);
      }
    }
  }

  function start() {
    if (!source.trim()) return;
    setIsTranslating(true);

    const seg = segmentMarkdown(source, settings.options);
    setSegCtx(seg);

    const byId: Record<string, string> = {};
    setProgress({ byId, done: {}, errors: {} });

    const payload: ApiTranslateRequest = {
      segments: seg.segments.map(s => ({ id: s.id, text: s.text, kind: s.kind } as any)),
      targetLang: settings.targetLang,
      glossary: settings.glossary,
      protectedTerms: settings.protectedTerms,
      options: settings.options,
      model: settings.model,
      concurrency: settings.concurrency,
    } as any;

    const controller = new AbortController();
    abortRef.current = controller;

    fetch('/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(settings.apiKey ? { 'x-openai-key': settings.apiKey } : {}),
        ...(settings.apiBase ? { 'x-openai-base': settings.apiBase } : {}),
        'x-openai-concurrency': String(settings.concurrency || 3),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }).then(async (res) => {
      if (!res.ok || !res.body) throw new Error('request failed');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          try {
            const ev = JSON.parse(data) as any;
            if (ev.type === 'delta') {
              setProgress((p) => {
                const cur = p.byId[ev.segmentId] || '';
                const next = cur + ev.delta;
                const updated = { ...p, byId: { ...p.byId, [ev.segmentId]: next } };
                if (seg) {
                  const tree = applyTranslations(seg.tree, seg.idToTextNodes, seg.idToImageNodes, updated.byId);
                  const md = toMarkdownString(tree);
                  setTranslatedMd(md);
                }
                return updated;
              });
            } else if (ev.type === 'done') {
              setProgress((p) => ({ ...p, done: { ...p.done, [ev.segmentId]: true } }));
            } else if (ev.type === 'error') {
              console.error('Segment error', ev?.message || ev);
              setProgress((p)=>({ ...p, errors: { ...p.errors, [ev.segmentId]: ev.message || 'error' } }));
              showToast(t(ui,'error'), ev?.message || 'Upstream error');
            }
          } catch {}
        }
      }
    }).catch((err) => {
      console.error('Translate request failed', err);
      showToast(t(ui,'error'), err?.message || 'Request failed');
    }).finally(() => {
      setIsTranslating(false);
      abortRef.current = null;
    });
  }

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsTranslating(false);
  }

  function onCopy() {
    navigator.clipboard.writeText(translatedMd || '');
    showToast(t(ui, 'done'), t(ui, 'copy'));
  }

  function onDownload() {
    downloadText('translated.md', translatedMd || '');
    showToast(t(ui, 'done'), t(ui, 'download'));
  }

  async function onExportZip() {
    try {
      const zip = new JSZip();
      zip.file('source.md', source || '');
      zip.file('translated.md', translatedMd || '');
      zip.file('settings.json', JSON.stringify(settings, null, 2));
      const blob = await zip.generateAsync({ type: 'blob' });
      saveAs(blob, 'babelmark-export.zip');
      showToast(t(ui, 'done'), t(ui, 'exportZip'));
    } catch (e: any) {
      showToast(t(ui, 'error'), e?.message || 'Export failed');
    }
  }

  function addGlossary() {
    const s = glossSource.trim();
    const trg = glossTarget.trim();
    if (!s || !trg) return;
    setSettings((prev) => ({ ...prev, glossary: [...prev.glossary, { source: s, target: trg }] }));
    setGlossSource('');
    setGlossTarget('');
    showToast(t(ui, 'done'), t(ui, 'glossary'));
  }

  function removeGlossary(idx: number) {
    setSettings((prev) => ({ ...prev, glossary: prev.glossary.filter((_, i) => i !== idx) }));
  }

  function addProtected() {
    const term = protInput.trim();
    if (!term) return;
    if (settings.protectedTerms.includes(term)) { setProtInput(''); return; }
    setSettings((prev) => ({ ...prev, protectedTerms: [...prev.protectedTerms, term] }));
    setProtInput('');
  }

  function removeProtected(idx: number) {
    setSettings((prev) => ({ ...prev, protectedTerms: prev.protectedTerms.filter((_, i) => i !== idx) }));
  }

  return (
    <main className="min-h-screen grid grid-rows-[auto_1fr]">
      <header className="border-b bg-white/80 dark:bg-zinc-950/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-3">
          <div className="font-semibold text-lg">{t(ui, 'appTitle')}</div>
          <div className="ml-auto flex items-center gap-3">
            <label className="text-sm">
              {t(ui, 'targetLanguage')}: {' '}
              <select
                className="ml-2 rounded border bg-transparent px-2 py-1"
                value={settings.targetLang}
                onChange={(e) => setSettings({ ...settings, targetLang: e.target.value })}
                aria-label={t(ui, 'targetLanguage')}
              >
                {languages.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            </label>
            <button
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${isTranslating ? 'bg-red-600 text-white border-red-600' : 'bg-indigo-600 text-white border-indigo-600'}`}
              onClick={isTranslating ? stop : start}
              aria-label={isTranslating ? t(ui,'stop') : t(ui,'start')}
            >
              {isTranslating ? <Square size={16}/> : <CirclePlay size={16}/>} {isTranslating ? t(ui,'stop') : t(ui,'start')}
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm border-zinc-300 dark:border-zinc-700"
              onClick={onCopy}
              title={t(ui,'copy')}
              aria-label={t(ui,'copy')}
            >
              <Copy size={16}/> {t(ui,'copy')}
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm border-zinc-300 dark:border-zinc-700"
              onClick={onDownload}
              title={t(ui,'download')}
              aria-label={t(ui,'download')}
            >
              <Download size={16}/> {t(ui,'download')}
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm border-zinc-300 dark:border-zinc-700"
              onClick={onExportZip}
              title={t(ui,'exportZip')}
              aria-label={t(ui,'exportZip')}
            >
              <FileArchive size={16}/> {t(ui,'exportZip')}
            </button>
          </div>
        </div>
      </header>

      <section className="grid md:grid-cols-2 gap-0 min-h-0">
        <div className="border-r min-h-[calc(100vh-3.25rem)]">
          <div className="p-3 flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
            <div>{t(ui,'source')}</div>
            <div>{t(ui,'detectedLanguage')}: {detected || '-'}</div>
          </div>
          <textarea
            className="w-full h-[calc(100vh-5.5rem)] resize-none bg-transparent p-4 outline-none focus:ring-0"
            placeholder={t(ui,'dropHereOrPaste')}
            value={source}
            onChange={(e)=>setSource(e.target.value)}
            onDragOver={(e)=>e.preventDefault()}
            onDrop={handleDrop}
            spellCheck={false}
            aria-label={t(ui,'source')}
          />
          <div className="px-4 pb-4 flex flex-wrap gap-4 text-xs text-zinc-600 dark:text-zinc-400">
            <label className="flex items-center gap-2"><input type="checkbox" checked={settings.options.translateLinkText} onChange={(e)=>setSettings({...settings, options: {...settings.options, translateLinkText: e.target.checked}})} /> {t(ui,'translateLinkText')}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={settings.options.translateImageAlt} onChange={(e)=>setSettings({...settings, options: {...settings.options, translateImageAlt: e.target.checked}})} /> {t(ui,'translateImageAlt')}</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={settings.options.spellcheck} onChange={(e)=>setSettings({...settings, options: {...settings.options, spellcheck: e.target.checked}})} /> {t(ui,'spellcheck')}</label>
            <label className="flex items-center gap-2">
              {t(ui,'punctuationLocale')}:
              <select
                className="ml-2 rounded border bg-transparent px-2 py-1"
                value={settings.options.punctuationLocale || ''}
                onChange={(e)=>setSettings({...settings, options: {...settings.options, punctuationLocale: e.target.value || undefined}})}
                aria-label={t(ui,'punctuationLocale')}
              >
                <option value="">-</option>
                <option value="en">English</option>
                <option value="zh">中文</option>
                <option value="ja">日本語</option>
              </select>
            </label>
          </div>
          <div className="px-4 pb-6 text-xs">
            <div className="flex gap-2">
              <input
                className="flex-1 rounded border bg-transparent px-2 py-1"
                placeholder={t(ui,'apiKey')}
                value={settings.apiKey || ''}
                onChange={(e)=>setSettings({...settings, apiKey: e.target.value})}
                aria-label={t(ui,'apiKey')}
              />
              <input
                className="flex-1 rounded border bg-transparent px-2 py-1"
                placeholder={t(ui,'apiBase')}
                value={settings.apiBase || ''}
                onChange={(e)=>setSettings({...settings, apiBase: e.target.value})}
                aria-label={t(ui,'apiBase')}
              />
              <input
                className="flex-1 rounded border bg-transparent px-2 py-1"
                placeholder={t(ui,'model')}
                value={settings.model}
                onChange={(e)=>setSettings({...settings, model: e.target.value})}
                aria-label={t(ui,'model')}
              />
              <input
                type="number"
                className="w-28 rounded border bg-transparent px-2 py-1"
                placeholder={t(ui,'concurrency')}
                value={Number.isFinite(settings.concurrency as any) ? settings.concurrency : 3}
                onChange={(e)=>{
                  const v = parseInt(e.target.value || '3', 10);
                  const n = isNaN(v) ? 3 : Math.max(1, Math.min(v, 30));
                  setSettings({...settings, concurrency: n});
                }}
                min={1}
                max={30}
                aria-label={t(ui,'concurrency')}
                title={t(ui,'concurrency')}
              />
              <select
                className="rounded border bg-transparent px-2 py-1"
                value={settings.uiLang}
                onChange={(e)=>setSettings({...settings, uiLang: e.target.value as any})}
                aria-label={t(ui,'uiLanguage')}
              >
                <option value="en">English</option>
                <option value="zh">中文</option>
              </select>
            </div>
          </div>
          <div className="px-4 pb-6 text-xs">
            <div className="font-medium mb-2">{t(ui,'glossary')}</div>
            <div className="flex gap-2 mb-2">
              <input
                className="flex-1 rounded border bg-transparent px-2 py-1"
                placeholder={t(ui,'sourceTerm')}
                value={glossSource}
                onChange={(e)=>setGlossSource(e.target.value)}
                aria-label={t(ui,'sourceTerm')}
              />
              <input
                className="flex-1 rounded border bg-transparent px-2 py-1"
                placeholder={t(ui,'targetTerm')}
                value={glossTarget}
                onChange={(e)=>setGlossTarget(e.target.value)}
                aria-label={t(ui,'targetTerm')}
              />
              <button
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs border-zinc-300 dark:border-zinc-700"
                onClick={addGlossary}
                aria-label={t(ui,'add')}
              >
                <Plus size={14}/> {t(ui,'add')}
              </button>
            </div>
            <ul className="space-y-1">
              {settings.glossary.map((g, idx) => (
                <li key={idx} className="flex items-center justify-between">
                  <span className="truncate">{g.source} = {g.target}</span>
                  <button className="p-1 text-zinc-500 hover:text-red-600" onClick={()=>removeGlossary(idx)} aria-label={t(ui,'remove')}>
                    <X size={14}/>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="px-4 pb-6 text-xs">
            <div className="font-medium mb-2">{t(ui,'protectedTerms')}</div>
            <div className="flex gap-2 mb-2">
              <input
                className="flex-1 rounded border bg-transparent px-2 py-1"
                placeholder={t(ui,'protectedTerms')}
                value={protInput}
                onChange={(e)=>setProtInput(e.target.value)}
                onKeyDown={(e)=>{ if (e.key === 'Enter') addProtected(); }}
                aria-label={t(ui,'protectedTerms')}
              />
              <button
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs border-zinc-300 dark:border-zinc-700"
                onClick={addProtected}
                aria-label={t(ui,'add')}
              >
                <Plus size={14}/> {t(ui,'add')}
              </button>
            </div>
            <ul className="flex flex-wrap gap-2">
              {settings.protectedTerms.map((term, idx) => (
                <li key={idx} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs border-zinc-300 dark:border-zinc-700">
                  <span>{term}</span>
                  <button className="p-0.5 text-zinc-500 hover:text-red-600" onClick={()=>removeProtected(idx)} aria-label={t(ui,'remove')}>
                    <X size={12}/>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="min-h-[calc(100vh-3.25rem)]">
          <div className="p-3 flex items-center justify-between text-xs text-zinc-600 dark:text-zinc-400">
            <div>Preview</div>
            <div>{t(ui,'progress')}: {Object.keys(progress.done).length}/{segCtx?.segments?.length || 0}</div>
          </div>
          <div className="prose prose-zinc dark:prose-invert max-w-none p-4">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>
              {translatedMd || ''}
            </ReactMarkdown>
          </div>
        </div>
      </section>
      <Toast.Root open={toastOpen} onOpenChange={setToastOpen} className="rounded-md bg-zinc-900 text-white p-3 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out">
        <Toast.Title className="font-medium">{toastTitle}</Toast.Title>
        <Toast.Description className="text-sm opacity-90">{toastDesc}</Toast.Description>
      </Toast.Root>
    </main>
  );
}
