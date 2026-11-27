import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Download,
  ExternalLink,
  FileAudio,
  FileCode2,
  FileImage,
  FileText,
  FolderOpen,
  Link2,
  Loader2,
  Save,
} from 'lucide-react';

/** 'openproject' is an import action that shares the export menus' plumbing. */
export type ExportFormat =
  | 'gabc'
  | 'png'
  | 'pdf'
  | 'mp3'
  | 'sourceandsummit'
  | 'project'
  | 'openproject'
  | 'link';

interface ExportMenuProps {
  busyFormat: ExportFormat | null;
  onExport: (format: ExportFormat) => void;
}

export const ExportMenu: React.FC<ExportMenuProps> = ({ busyFormat, onExport }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const items: { id: ExportFormat; label: string; desc: string; icon: React.ReactNode }[] = [
    {
      id: 'gabc',
      label: 'Export GABC',
      desc: 'Gregorio chant source (.gabc)',
      icon: <FileCode2 className="h-4 w-4 text-[#7C1B1B]" />,
    },
    {
      id: 'png',
      label: 'Export PNG',
      desc: 'High-resolution missal folio (.png)',
      icon: <FileImage className="h-4 w-4 text-[#7C1B1B]" />,
    },
    {
      id: 'pdf',
      label: 'Export PDF',
      desc: 'Print-ready archival sheet (.pdf)',
      icon: <FileText className="h-4 w-4 text-[#7C1B1B]" />,
    },
    {
      id: 'mp3',
      label: 'Export MP3',
      desc: 'Rendered with active organ (.mp3)',
      icon: <FileAudio className="h-4 w-4 text-[#7C1B1B]" />,
    },
    {
      id: 'project',
      label: 'Save project',
      desc: 'Everything, incl. fonts & page setup (.json)',
      icon: <Save className="h-4 w-4 text-[#7C1B1B]" />,
    },
    {
      id: 'openproject',
      label: 'Open project',
      desc: 'Load a saved project file (.json)',
      icon: <FolderOpen className="h-4 w-4 text-[#7C1B1B]" />,
    },
    {
      id: 'link',
      label: 'Copy share link',
      desc: 'A link that opens this score',
      icon: <Link2 className="h-4 w-4 text-[#7C1B1B]" />,
    },
    {
      id: 'sourceandsummit',
      label: 'Source & Summit',
      desc: 'Open S&S Editor with GABC loaded',
      icon: <ExternalLink className="h-4 w-4 text-[#7C1B1B]" />,
    },
  ];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busyFormat !== null}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#1D1915] hover:text-[#992323] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#992323]"
      >
        {busyFormat ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#992323]" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        <span>{busyFormat ? `Exporting ${busyFormat.toUpperCase()}...` : 'Export'}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-64 rounded-sm border border-[#C7BCA9] bg-[#FAF6EE] py-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setOpen(false);
                onExport(item.id);
              }}
              className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-[#F0E9DC] transition-colors"
            >
              <span className="mt-0.5 shrink-0">{item.icon}</span>
              <div>
                <div className="text-sm font-medium text-[#1D1915]">{item.label}</div>
                <div className="text-xs text-[#6B6257]">{item.desc}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
