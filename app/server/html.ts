import fs from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { config } from './config.js';

const imagesRoot = path.join(config.contentDir, '90-图片');
export const MISSING_IMAGE = '/media/__missing__.svg';

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'span', 'img', 'strong', 'em', 'b', 'i', 'u', 'sup', 'sub',
    'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'hr',
  ],
  allowedAttributes: {
    img: ['src', 'alt', 'title', 'class', 'flag', 'width', 'height'],
    span: ['class'],
    a: ['href', 'title', 'target', 'rel'],
    code: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: '_blank', rel: 'noreferrer noopener' },
    }),
  },
};

export type RenderResult = { html: string; hasImage: boolean; hasMissingImage: boolean };

function rewriteImages(text: string): { text: string; hasMissing: boolean } {
  let hasMissing = false;
  // 题库里的图片全部是 ../90-图片/xxx/yyy.png
  let out = text.replaceAll('../90-图片/', '/media/');
  out = out.replace(/\/media\/([^"'\s)<>]+)/g, (full, rel: string) => {
    let decoded = rel;
    try {
      decoded = decodeURIComponent(rel);
    } catch {
      /* keep as-is */
    }
    const abs = path.join(imagesRoot, decoded);
    if (!fs.existsSync(abs)) {
      hasMissing = true;
      return MISSING_IMAGE;
    }
    return full;
  });
  return { text: out, hasMissing };
}

function renderWith(parser: (src: string) => string, source: string): RenderResult {
  const { text, hasMissing } = rewriteImages(source);
  const raw = parser(text);
  const html = sanitizeHtml(raw, SANITIZE);
  return {
    html,
    hasImage: /<img\b/i.test(html),
    hasMissingImage: hasMissing || html.includes(MISSING_IMAGE),
  };
}

export function renderBlock(source: string): RenderResult {
  return renderWith((src) => marked.parse(src, { gfm: true, breaks: false, async: false }) as string, source);
}

export function renderInline(source: string): RenderResult {
  return renderWith((src) => marked.parseInline(src, { gfm: true, async: false }) as string, source);
}

export function imageExists(rel: string): boolean {
  return fs.existsSync(path.join(imagesRoot, rel));
}

export { imagesRoot };
