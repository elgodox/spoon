import React from 'react';

interface DiffViewerProps {
  filePath: string;
  staged: boolean;
  status?: string;
  diff: string;
  onStage: () => void;
  onUnstage: () => void;
  onClose: () => void;
  isLoading?: boolean;
  previewKind?: 'image' | 'video' | 'audio' | 'pdf' | 'binary';
  previewUrl?: string | null;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  filePath,
  staged,
  status,
  diff,
  onStage,
  onUnstage,
  onClose,
  isLoading,
  previewKind,
  previewUrl,
}) => {
  const lines = diff ? diff.split('\n') : [];
  const isPreviewable = Boolean(previewKind && previewUrl);

  const renderLine = (line: string, index: number) => {
    let className = 'diff-line px-2 py-px font-mono text-xs leading-tight whitespace-pre';

    if (line.startsWith('+++') || line.startsWith('---')) {
      className += ' bg-[#26262b] text-[#a3a3a3] font-semibold';
    } else if (line.startsWith('@@')) {
      className += ' bg-[#1f3a5f] text-[#7dd3fc]';
    } else if (line.startsWith('+')) {
      className += ' bg-[#14532d] text-[#86efac]';
    } else if (line.startsWith('-')) {
      className += ' bg-[#4c1d25] text-[#fda4af]';
    } else if (line.startsWith(' ')) {
      className += ' text-[#d4d4d8]';
    } else {
      className += ' text-[#71717a]';
    }

    return (
      <div key={index} className={className}>
        {line || ' '}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#111113] min-w-[280px] flex-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2a2a2f] bg-[#1a1a1d] flex-shrink-0">
        <div className="min-w-0">
          <div className="font-mono text-sm text-white truncate">{filePath}</div>
          <div className="text-[10px] text-zinc-400 flex items-center gap-2">
            {staged ? (
              <span className="text-sky-400">STAGED (cached diff)</span>
            ) : (
              <span className="text-amber-400">WORKING TREE</span>
            )}
            <span>•</span>
            <span>{status ?? 'modified'}</span>
            {!isPreviewable && (
              <>
                <span>•</span>
                <span>{lines.length} líneas</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {!staged ? (
            <button
              onClick={onStage}
              disabled={isLoading}
              className="text-xs px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50"
            >
              Stage file
            </button>
          ) : (
            <button
              onClick={onUnstage}
              disabled={isLoading}
              className="text-xs px-3 py-1 rounded bg-orange-700 hover:bg-orange-600 active:bg-orange-800 disabled:opacity-50"
            >
              Unstage file
            </button>
          )}
          <button
            onClick={onClose}
            className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto p-1 bg-[#0a0a0b] custom-scrollbar">
        {isLoading ? (
          <div className="p-4 text-center text-sm text-zinc-400">Cargando diff...</div>
        ) : isPreviewable && previewKind === 'image' ? (
          <div className="h-full flex items-center justify-center p-4">
            <img src={previewUrl ?? undefined} alt={filePath} className="max-h-full max-w-full object-contain rounded border border-[#2a2a2f]" />
          </div>
        ) : isPreviewable && previewKind === 'video' ? (
          <div className="h-full flex items-center justify-center p-4">
            <video src={previewUrl ?? undefined} controls className="max-h-full max-w-full rounded border border-[#2a2a2f]" />
          </div>
        ) : isPreviewable && previewKind === 'audio' ? (
          <div className="h-full flex items-center justify-center p-4">
            <audio src={previewUrl ?? undefined} controls className="w-full max-w-xl" />
          </div>
        ) : isPreviewable && previewKind === 'pdf' ? (
          <iframe src={previewUrl ?? undefined} className="h-full w-full rounded border border-[#2a2a2f]" title={filePath} />
        ) : previewKind === 'binary' ? (
          <div className="p-4 text-center">
            <div className="text-sm text-zinc-300">Vista previa binaria no soportada.</div>
            <div className="text-xs text-zinc-500 mt-1">Imágenes, video, audio y PDF se muestran acá cuando existen en el working tree.</div>
          </div>
        ) : !diff || diff.trim() === '' ? (
          <div className="p-4 text-center">
            <div className="text-sm text-zinc-400">No hay cambios para mostrar.</div>
            <div className="text-xs text-zinc-500 mt-1">El archivo puede estar vacío, binario, borrado o solo renombrado.</div>
          </div>
        ) : (
          <div className="text-[13px] leading-[1.25]">
            {lines.map((line, i) => renderLine(line, i))}
          </div>
        )}
      </div>

      <div className="px-3 py-1.5 text-[10px] text-zinc-500 border-t border-[#2a2a2f] bg-[#1a1a1d]">
        Vista previa para imágenes, video, audio y PDF. Para texto se muestra el diff.
      </div>
    </div>
  );
};

export default DiffViewer;
