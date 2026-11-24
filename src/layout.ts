// Fixed three-container layout used on every page. Switching pages only
// rewrites text (textContainerUpgrade), so there is no rebuild flicker.

import { CANVAS_W, LINE_H } from './format';

export interface Box {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  padding: number;
  border: number;
  textColor: number;
}

export const HEADER: Box = { id: 1, name: 'sg-header', x: 0, y: 0, w: CANVAS_W, h: 36, padding: 4, border: 0, textColor: 4 };
export const BODY: Box = { id: 2, name: 'sg-body', x: 0, y: 36, w: CANVAS_W, h: 216, padding: 4, border: 1, textColor: 4 };
export const FOOTER: Box = { id: 3, name: 'sg-footer', x: 0, y: 252, w: CANVAS_W, h: 36, padding: 4, border: 0, textColor: 2 };

export function innerWidth(b: Box): number {
  return b.w - 2 * (b.padding + b.border);
}

export function maxLines(b: Box): number {
  return Math.floor((b.h - 2 * (b.padding + b.border)) / LINE_H);
}
