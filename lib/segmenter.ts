import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkStringify from 'remark-stringify';
import type { Segment, TranslationOptions } from './types';

export const SEP = '\u241E'; // ␞ symbol for splitting text nodes

export interface SegmentationResult {
  tree: any;
  segments: Segment[];
  idToTextNodes: Record<string, any[]>;
  idToImageNodes: Record<string, any[]>;
}

export function segmentMarkdown(markdown: string, options: TranslationOptions): SegmentationResult {
  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter).parse(markdown);

  const segments: Segment[] = [];
  const idToTextNodes: Record<string, any[]> = {};
  const idToImageNodes: Record<string, any[]> = {};
  let sid = 0;
  let iid = 0;

  function collectTextNodes(node: any, out: any[], ctx: { inCode: boolean; ignoreLinkChildren: boolean }) {
    if (!node) return;
    const type = node.type;

    if (type === 'code' || type === 'inlineCode') return; // never translate
    if (type === 'link' && !options.translateLinkText) return; // skip link children entirely

    if (type === 'text') {
      if (!ctx.inCode && !ctx.ignoreLinkChildren && typeof node.value === 'string' && node.value.trim().length > 0) {
        out.push(node);
      }
      return;
    }

    const nextCtx = {
      inCode: ctx.inCode || type === 'code' || type === 'inlineCode',
      ignoreLinkChildren: ctx.ignoreLinkChildren || (type === 'link' && !options.translateLinkText),
    };

    if (Array.isArray(node.children)) {
      for (const child of node.children) collectTextNodes(child, out, nextCtx);
    }
  }

  function makeTextSegment(containerNode: any) {
    const nodes: any[] = [];
    collectTextNodes(containerNode, nodes, { inCode: false, ignoreLinkChildren: false });
    if (nodes.length === 0) return;
    const text = nodes.map((n) => String(n.value || '')).join(SEP);
    if (text.trim().length === 0) return;
    const id = `s${++sid}`;
    segments.push({ id, text, kind: 'text' });
    idToTextNodes[id] = nodes;
  }

  function visit(node: any, parent?: any) {
    if (!node) return;
    switch (node.type) {
      case 'paragraph':
      case 'heading':
      case 'listItem':
      case 'tableCell':
        makeTextSegment(node);
        break;
      case 'image':
        if (options.translateImageAlt && node.alt && String(node.alt).trim().length > 0) {
          const id = `img${++iid}`;
          segments.push({ id, text: String(node.alt), kind: 'image-alt' });
          idToImageNodes[id] = [node];
        }
        break;
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child, node);
    }
  }

  visit(tree);

  return { tree, segments, idToTextNodes, idToImageNodes };
}

export function applyTranslations(
  tree: any,
  idToTextNodes: Record<string, any[]>,
  idToImageNodes: Record<string, any[]>,
  translations: Record<string, string>
) {
  // mutate the original tree in-place for performance
  // (downstream renders the returned tree immediately)

  for (const [id, nodes] of Object.entries(idToTextNodes)) {
    const t = translations[id];
    if (!t) continue;
    const parts = String(t).split(SEP);
    if (parts.length === nodes.length) {
      nodes.forEach((origNode, idx) => {
        // find corresponding node in copy by path is non-trivial; fallback to setting on original reference
        // Since we cloned, we replace on original nodes directly (they will not be used for display simultaneously)
        (origNode as any).value = parts[idx];
      });
    } else {
      (nodes[0] as any).value = String(t);
    }
  }

  for (const [id, nodes] of Object.entries(idToImageNodes)) {
    const t = translations[id];
    if (!t) continue;
    for (const n of nodes) {
      (n as any).alt = String(t);
    }
  }

  return tree;
}

export function toMarkdownString(tree: any): string {
  const str = unified()
    .use(remarkGfm as any)
    .use(remarkFrontmatter as any)
    .use(remarkStringify as any)
    .stringify(tree as any);
  let out = String(str);
  // Unescape escaped asterisks inside LaTeX math blocks/spans so formulas render correctly
  // $$ ... $$ (block math)
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_m, inner) => `$$${String(inner).replace(/\\\*/g, '*')}$$`);
  // $ ... $ (inline math) — avoid crossing lines to reduce false positives
  out = out.replace(/\$([^$\n]*?)\$/g, (_m, inner) => `$${String(inner).replace(/\\\*/g, '*')}$`);
  return out;
}
