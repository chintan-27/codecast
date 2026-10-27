import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };

monaco.editor.defineTheme('codecast', {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8A948D', fontStyle: 'italic' },
    { token: 'keyword', foreground: '8A567C' },
    { token: 'string', foreground: '52704D' },
    { token: 'number', foreground: 'AA7139' },
    { token: 'type.identifier', foreground: '397C81' },
  ],
  colors: {
    'editor.background': '#FCFCF9',
    'editor.foreground': '#34443E',
    'editorLineNumber.foreground': '#ADB5AD',
    'editorLineNumber.activeForeground': '#2C6C55',
    'editor.lineHighlightBackground': '#00000000',
    'editor.selectionBackground': '#D5E9D9',
    'editorGutter.background': '#FCFCF9',
    'editorIndentGuide.background1': '#E8EBE4',
  },
});

export function CodeViewer({
  source,
  file,
  range,
}: {
  source: string;
  file: string;
  range?: { startLine: number; endLine: number };
}) {
  const element = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);

  useEffect(() => {
    if (!element.current) return;
    editor.current = monaco.editor.create(element.current, {
      value: '',
      theme: 'codecast',
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
      lineHeight: 26,
      padding: { top: 24, bottom: 24 },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'none',
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      folding: false,
      lineNumbersMinChars: 3,
      glyphMargin: true,
      stickyScroll: { enabled: false },
      contextmenu: false,
    });
    decorations.current = editor.current.createDecorationsCollection();
    return () => {
      editor.current?.getModel()?.dispose();
      editor.current?.dispose();
    };
  }, []);

  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    const extension = file.split('.').pop();
    const languages: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      json: 'json',
      css: 'css',
      md: 'markdown',
    };
    const previous = instance.getModel();
    const model = monaco.editor.createModel(source, languages[extension ?? ''] ?? 'plaintext');
    instance.setModel(model);
    previous?.dispose();
  }, [source, file]);

  useEffect(() => {
    decorations.current?.set(
      range
        ? [
            {
              range: new monaco.Range(range.startLine, 1, range.endLine, 1),
              options: {
                isWholeLine: true,
                className: 'lesson-highlight',
                linesDecorationsClassName: 'lesson-gutter',
              },
            },
          ]
        : [],
    );
    if (range) editor.current?.revealLinesInCenter(range.startLine, range.endLine);
  }, [source, file, range?.startLine, range?.endLine]);

  return (
    <div
      className="monaco-container"
      ref={element}
      aria-label={`Source code: ${file}`}
      data-testid="code-viewer"
    />
  );
}
