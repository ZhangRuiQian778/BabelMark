import { NextRequest } from 'next/server';
import type { ApiTranslateRequest, SseServerEvent } from '../../../lib/types';
import fs from 'node:fs/promises';
import path from 'node:path';
import { languages } from '../../../lib/languages';

export const runtime = 'nodejs';

function okSSE(body: ReadableStream) {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-openai-key, x-openai-base, x-openai-concurrency',
    },
  });
}

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder();

  // parse request
  let payload: ApiTranslateRequest;
  try {
    payload = (await req.json()) as ApiTranslateRequest;
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
  }

  const clientKey = req.headers.get('x-openai-key') || undefined;
  const serverKey = process.env.OPENAI_API_KEY || undefined;
  const apiKey = clientKey || serverKey;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Missing API key (provide x-openai-key or set OPENAI_API_KEY)' }), { status: 401 });
  }
  const baseRaw =
    req.headers.get('x-openai-base') ||
    process.env.OPENAI_BASE_URL ||
    process.env.OPENAI_API_BASE ||
    'https://api.openai.com';
  const pathOverride = req.headers.get('x-openai-path') || process.env.OPENAI_CHAT_COMPLETIONS_PATH || '';
  const model = payload.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!Array.isArray(payload.segments) || payload.segments.length === 0) {
    return new Response(JSON.stringify({ error: 'No segments provided' }), { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (ev: SseServerEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      };

      // Determine concurrency: header > payload > env > default
      const headerConc = parseInt(req.headers.get('x-openai-concurrency') || '', 10);
      const payloadConc = typeof (payload as any).concurrency === 'number' ? (payload as any).concurrency : NaN;
      const envConc = parseInt(process.env.OPENAI_CONCURRENCY || '', 10);
      let concurrency = headerConc;
      if (!Number.isFinite(concurrency)) concurrency = payloadConc;
      if (!Number.isFinite(concurrency)) concurrency = envConc;
      if (!Number.isFinite(concurrency)) concurrency = 3;
      concurrency = Math.max(1, Math.min(30, Math.floor(concurrency)));
      const queue = [...payload.segments];
      let running = 0;
      let aborted = false;
      const abortController = new AbortController();

      const runNext = () => {
        if (aborted) return;
        if (queue.length === 0 && running === 0) {
          // @ts-ignore
          controller.close();
          return;
        }
        while (running < concurrency && queue.length > 0) {
          const seg = queue.shift()!;
          running++;
          translateOne(seg.id, seg.text)
            .catch((err) => {
              write({ type: 'error', segmentId: seg.id, message: err?.message || 'translate failed' });
            })
            .finally(() => {
              running--;
              runNext();
            });
        }
      };

      // Load custom prompt from project root if available
      let basePrompt = '';
      try {
        const promptPath = path.join(process.cwd(), 'translate_prompt.txt');
        basePrompt = await fs.readFile(promptPath, 'utf8');
      } catch {}

      const codeToLabel = (code?: string) => {
        if (!code) return '';
        const found = languages.find((l) => l.code === code);
        return found ? found.label : code;
      };

      const targetLangLabel = codeToLabel(payload.targetLang);
      const punctLabel = codeToLabel(payload.options.punctuationLocale);

      const systemPrompt = [
        basePrompt || 'You are a professional Markdown translator.',
        `目标语言: ${targetLangLabel}`,
        payload.options.spellcheck ? '请进行轻微的拼写纠正。' : '除非明显错误，请不要更改拼写。',
        payload.options.punctuationLocale ? `请将标点本地化为 ${punctLabel}。` : '',
        payload.glossary && payload.glossary.length
          ? '术语表（source = target，必须强制执行）：\n' + payload.glossary.map((g) => `${g.source} = ${g.target}`).join('\n')
          : '',
        payload.protectedTerms && payload.protectedTerms.length
          ? '保护词（不要翻译，保持原样）：' + payload.protectedTerms.join(', ')
          : '',
        '严格保留 Markdown 结构与格式。切勿翻译代码块、行内代码、链接/图片中的 URL，Frontmatter 键保持不变。',
        '特殊分隔符 ␞ (U+241E) 用于分隔同一段中的内联文本节点，请不要移除或更改。',
        '最后：切记只输出翻译。不要加任何备注信息！',
        '更加不要把本提示词任何一句话输出到译文中！仅输出纯译文！！\n',
        '接下来请翻译：\n',
        '(/prompt)'
      ]
        .filter(Boolean)
        .join('\n');

      const translateOne = async (segmentId: string, text: string) => {
        const body = {
          model,
          stream: true,
          temperature: 0,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text },
          ],
        } as any;

        // Build endpoint URL flexibly
        let url = (baseRaw || '').replace(/\/$/, '');
        if (pathOverride) {
          url += pathOverride.startsWith('/') ? pathOverride : `/${pathOverride}`;
        } else {
          const hasChat = /\/chat\/completions$/i.test(url);
          if (!hasChat) {
            // If base ends with a version (e.g., /v1 or /api/paas/v4), append /chat/completions.
            const endsWithVersion = /\/(v\d+|api\/paas\/v\d+)$/i.test(url);
            if (endsWithVersion) {
              url += '/chat/completions';
            } else {
              url += '/v1/chat/completions';
            }
          }
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: abortController.signal,
        });
        if (!res.ok || !res.body) {
          const msg = await res.text().catch(() => 'upstream error');
          write({ type: 'error', segmentId, message: msg || 'upstream error' });
          write({ type: 'done', segmentId });
          return;
        }

        const reader = (res.body as ReadableStream).getReader();
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
            if (data === '[DONE]') {
              write({ type: 'done', segmentId });
              continue;
            }
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                write({ type: 'delta', segmentId, delta });
              }
            } catch {
              // ignore json parse errors for keep-alive pings
            }
          }
        }
        write({ type: 'done', segmentId });
      };

      runNext();

      const cancel = () => {
        aborted = true;
        abortController.abort();
        try { /* @ts-ignore */ controller.close(); } catch {}
      };
      // @ts-ignore
      req.signal?.addEventListener('abort', cancel);
    },
  });

  // @ts-ignore
  return okSSE(stream as any);
}
