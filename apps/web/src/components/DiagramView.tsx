import { useEffect, useRef, useState } from 'react';

/**
 * Показ схемы официальным просмотрщиком draw.io — рисуется тот же XML, что скачивается в .drawio,
 * поэтому картинка в интерфейсе и файл всегда совпадают.
 */
const VIEWER_SRC = 'https://viewer.diagrams.net/js/viewer-static.min.js';

declare global {
  interface Window {
    GraphViewer?: any;
  }
}

let loader: Promise<void> | null = null;
function loadViewer(): Promise<void> {
  if (window.GraphViewer) return Promise.resolve();
  loader ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = VIEWER_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loader = null;
      reject(new Error('Не удалось загрузить просмотрщик draw.io (нужен доступ к viewer.diagrams.net).'));
    };
    document.head.appendChild(s);
  });
  return loader;
}

export function DiagramView({ xml, version, onRendered }: { xml: string; version: number; onRendered: (version: number) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const viewer = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadViewer()
      .then(() => {
        if (cancelled || !host.current) return;
        const el = document.createElement('div');
        el.className = 'mxgraph';
        // Без auto-fit: иначе просмотрщик ставит viewBox и масштаб применяется дважды. Вписываем сами в fit().
        el.setAttribute('data-mxgraph', JSON.stringify({ xml, toolbar: '', nav: false, resize: false, lightbox: false }));
        host.current.replaceChildren(el);
        window.GraphViewer.createViewerForElement(el, (v: any) => {
          if (cancelled) return;
          viewer.current = v;
          (window as any).__sxViewer = v; // для отладки и автотестов
          fit();
          requestAnimationFrame(() => onRendered(version));
        });
      })
      .catch((e) => {
        setError(e.message);
        onRendered(version);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml, version]);

  const zoom = (k: number) => {
    const g = viewer.current?.graph;
    if (!g) return;
    if (k > 1) g.zoomIn();
    else g.zoomOut();
  };
  const fit = () => {
    const g = viewer.current?.graph;
    if (!g || !host.current) return;
    // Границы графа в экранных координатах → в координаты модели с учётом текущего сдвига.
    const b = g.getGraphBounds();
    const s = g.view.scale;
    const t = g.view.translate;
    const mx = b.x / s - t.x;
    const my = b.y / s - t.y;
    const mw = b.width / s;
    const mh = b.height / s;
    const w = host.current.clientWidth - 24;
    const h = host.current.clientHeight - 48; // отступ просмотрщика сверху и поля
    const scale = Math.min(w / mw, h / mh, 2);
    g.view.scaleAndTranslate(scale, -mx + (w / scale - mw) / 2, -my);
  };

  return (
    <div className="diagram">
      <div className="diagram-tools">
        <button className="btn ghost" onClick={() => zoom(1.25)} aria-label="Увеличить">
          ＋
        </button>
        <button className="btn ghost" onClick={() => zoom(0.8)} aria-label="Уменьшить">
          －
        </button>
        <button className="btn ghost" onClick={fit}>
          Целиком
        </button>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="diagram-host" ref={host} />
    </div>
  );
}
