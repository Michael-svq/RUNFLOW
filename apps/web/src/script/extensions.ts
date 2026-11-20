import { mergeAttributes, Node } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { ScriptKind } from '@runflow/sync';
import { RotuloView } from './RotuloView';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    scriptKind: {
      /** Cambia el tipo del párrafo: paso (verde), off (negro) o nota (gris). */
      setScriptKind: (kind: ScriptKind) => ReturnType;
    };
    rotulo: {
      /** Inserta un bloque de rótulo del tipo indicado. */
      insertRotulo: (type: string) => ReturnType;
    };
  }
}

/** Párrafo con tipo (el color es solo presentación). */
export const ScriptParagraph = Paragraph.extend({
  addAttributes() {
    return {
      kind: {
        default: 'paso',
        keepOnSplit: true,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-kind') ?? 'paso',
        renderHTML: (attrs: { kind?: string }) => ({
          'data-kind': attrs.kind ?? 'paso',
          class: `rf-script-${attrs.kind ?? 'paso'}`,
        }),
      },
    };
  },

  addCommands() {
    return {
      setScriptKind:
        (kind: ScriptKind) =>
        ({ commands }) =>
          commands.updateAttributes('paragraph', { kind }),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-1': () => this.editor.commands.setScriptKind('paso'),
      'Mod-2': () => this.editor.commands.setScriptKind('off'),
      'Mod-3': () => this.editor.commands.setScriptKind('nota'),
    };
  },
});

const ATTRS = ['id', 'type', 'f0', 'f1', 'f2', 'f3', 'tcIn', 'tcOut'] as const;

/** Bloque de rótulo: estructurado (tipo + campos + TC), no texto libre. */
export const Rotulo = Node.create({
  name: 'rotulo',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return Object.fromEntries(
      ATTRS.map((key) => [
        key,
        {
          default: '',
          parseHTML: (el: HTMLElement) => el.getAttribute(`data-${key.toLowerCase()}`) ?? '',
          renderHTML: (attrs: Record<string, string>) => ({
            [`data-${key.toLowerCase()}`]: attrs[key],
          }),
        },
      ]),
    );
  },

  parseHTML() {
    return [{ tag: 'div[data-rotulo]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-rotulo': '' }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(RotuloView);
  },

  addCommands() {
    return {
      insertRotulo:
        (type: string) =>
        ({ commands }) =>
          commands.insertContent([
            { type: 'rotulo', attrs: { id: crypto.randomUUID(), type } },
            { type: 'paragraph', attrs: { kind: 'off' } },
          ]),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-r': () => this.editor.commands.insertRotulo('TOT'),
    };
  },
});
