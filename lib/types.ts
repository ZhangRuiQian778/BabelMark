export type UILang = 'en' | 'zh';

export interface GlossaryEntry {
  source: string;
  target: string;
}

export interface TranslationOptions {
  translateLinkText: boolean;
  translateImageAlt: boolean;
  preserveEmptyLines: boolean;
  spellcheck: boolean;
  punctuationLocale?: string;
}

export interface Segment {
  id: string;
  text: string;
  kind: 'text' | 'image-alt';
}

export interface ApiTranslateRequest {
  segments: Segment[];
  targetLang: string;
  glossary: GlossaryEntry[];
  protectedTerms: string[];
  options: TranslationOptions;
  model?: string;
  concurrency?: number;
}

export type SseServerEvent =
  | { type: 'delta'; segmentId: string; delta: string }
  | { type: 'done'; segmentId: string }
  | { type: 'error'; segmentId: string; message: string };

export interface AppSettings {
  targetLang: string;
  model: string;
  uiLang: UILang;
  apiKey?: string;
  apiBase?: string;
  options: TranslationOptions;
  glossary: GlossaryEntry[];
  protectedTerms: string[];
  concurrency: number;
}

export interface TranslateProgress {
  byId: Record<string, string>;
  done: Record<string, boolean>;
  errors: Record<string, string | undefined>;
}
