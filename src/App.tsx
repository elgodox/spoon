import { useState, useEffect, useRef } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

import { FolderOpen, RefreshCw, GitBranch, Search } from 'lucide-react';

import {
  CommandResult,
  DetectedCli,
  Project,
  GitBranch as GitBranchType,
  FileChange,
  GitStatus,
} from './types';
import DiffViewer from './components/DiffViewer';
import { AITerminal } from './components/Terminal';
import './App.css';

// Constants removed - no longer using Trello-style groups

type ResizableColumnKey = 'projects' | 'refs' | 'files' | 'diff';

const DEFAULT_COLUMN_WIDTHS: Record<ResizableColumnKey, number> = {
  projects: 320,
  refs: 256,
  files: 384,
  diff: 720,
};

const MIN_COLUMN_WIDTHS: Record<ResizableColumnKey, number> = {
  projects: 240,
  refs: 220,
  files: 280,
  diff: 360,
};

function App() {
  const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
  const videoExtensions = new Set(['mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv']);
  const audioExtensions = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac']);
  const pdfExtensions = new Set(['pdf']);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [cliCommands, setCliCommands] = useState<DetectedCli[]>([]);
  const [remotes, setRemotes] = useState<string[]>([]);
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [stashes, setStashes] = useState<string[]>([]);

  // Projects sidebar (left column with list + buscador)
  const [showProjectsSidebar, setShowProjectsSidebar] = useState(true);
  const [autoHideProjects, setAutoHideProjects] = useState(false);
  const [columnWidths, setColumnWidths] = useState<Record<ResizableColumnKey, number>>(() => {
    const saved = localStorage.getItem('columnWidths');
    if (!saved) return DEFAULT_COLUMN_WIDTHS;
    try {
      return { ...DEFAULT_COLUMN_WIDTHS, ...JSON.parse(saved) };
    } catch {
      return DEFAULT_COLUMN_WIDTHS;
    }
  });
  const dragRef = useRef<{ key: ResizableColumnKey; startX: number; startWidth: number } | null>(null);
  const [isResizing, setIsResizing] = useState(false);



  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');

  // Project filter / search
  const [projectFilter, setProjectFilter] = useState('');

  // Diff viewer state
  const [selectedFileForDiff, setSelectedFileForDiff] = useState<{ path: string; staged: boolean; status: string } | null>(null);
  const [currentDiff, setCurrentDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);
  const [preview, setPreview] = useState<{ kind?: 'image' | 'video' | 'audio' | 'pdf' | 'binary'; url: string | null }>({ url: null });



  // Remember last directory and filter
  const [_lastDir, setLastDir] = useState(() => localStorage.getItem('lastDir') || '');

  useEffect(() => {
    localStorage.setItem('projectFilter', projectFilter);
  }, [projectFilter]);

  useEffect(() => {
    invoke<DetectedCli[]>('detect_cli_commands')
      .then((detected) => setCliCommands(detected))
      .catch((err) => console.error('detect_cli_commands failed', err));
  }, []);

  useEffect(() => {
    localStorage.setItem('columnWidths', JSON.stringify(columnWidths));
  }, [columnWidths]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (event: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      const nextWidth = Math.max(
        MIN_COLUMN_WIDTHS[drag.key],
        drag.startWidth + (event.clientX - drag.startX)
      );

      setColumnWidths((prev) => (
        prev[drag.key] === nextWidth ? prev : { ...prev, [drag.key]: nextWidth }
      ));
    };

    const handleMouseUp = () => {
      dragRef.current = null;
      setIsResizing(false);
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Auto-load last directory on startup
  useEffect(() => {
    const savedDir = localStorage.getItem('lastDir');
    if (savedDir && projects.length === 0) {
      (async () => {
        try {
          setIsLoading(true);
          setStatusMsg('Cargando último directorio...');
          const scanned: Project[] = await invoke('scan_directory', { rootPath: savedDir });
          setProjects(scanned);
          setLastDir(savedDir);
          if (scanned.length > 0) {
            // auto-select first project so the inner view + shell starts immediately
            setTimeout(() => loadProject(scanned[0]), 0);
          }
        } catch (err) {
          console.error(err);
        } finally {
          setIsLoading(false);
          setStatusMsg('');
        }
      })();
    }
    const savedFilter = localStorage.getItem('projectFilter');
    if (savedFilter) setProjectFilter(savedFilter);
  }, []);



  // Open native dir picker and scan
  async function handleOpenDirectory() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Selecciona la carpeta raíz de tus proyectos',
      });

      if (!selected || Array.isArray(selected)) return;

      setIsLoading(true);
      setStatusMsg('Escaneando proyectos...');

      const scanned: Project[] = await invoke('scan_directory', { rootPath: selected });
      setProjects(scanned);
      const pathStr = selected as string;
      localStorage.setItem('lastDir', pathStr);
      setLastDir(pathStr);

      setStatusMsg(`Encontrados ${scanned.length} repositorios Git`);
      setTimeout(() => setStatusMsg(''), 2500);
    } catch (err: any) {
      console.error(err);
      setStatusMsg(`Error: ${err}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadProject(project: Project) {
    setSelectedProject(project);
    setIsLoading(true);

    try {
      const brs = (await invoke('get_branches', { repoPath: project.path })) as GitBranchType[];
      const rms = (await invoke('get_remotes', { repoPath: project.path })) as string[];
      const chgs = (await invoke('get_file_changes', { repoPath: project.path })) as FileChange[];
      const tgs = (await invoke('get_tags', { repoPath: project.path })) as string[];
      const sts = (await invoke('get_stashes', { repoPath: project.path })) as string[];
      const gitStatus = (await invoke('get_project_status', { repoPath: project.path })) as GitStatus;

      setBranches(brs);
      setRemotes(rms);
      setChanges(chgs);
      setTags(tgs);
      setStashes(sts);
      setProjects((prev) => prev.map((item) => (
        item.id === project.id ? { ...item, git_status: gitStatus } : item
      )));
      setSelectedProject((prev) => (
        prev?.id === project.id ? { ...prev, git_status: gitStatus } : prev
      ));

      if (autoHideProjects) {
        setShowProjectsSidebar(false);
      }

      // Keep diff viewer open if the file is still there (update staged flag)
      if (selectedFileForDiff) {
        const stillThere = chgs.find((c) => c.path === selectedFileForDiff.path);
        if (stillThere) {
          const newSel = { path: stillThere.path, staged: stillThere.staged, status: stillThere.status };
          setSelectedFileForDiff(newSel);
          loadFileDiff(stillThere.path, stillThere.staged);
        } else {
          closeDiff();
        }
      }
    } catch (e: any) {
      console.error(e);
      setStatusMsg('Error cargando datos del repo: ' + e);
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshStatus() {
    if (!selectedProject) return;
    await loadProject(selectedProject);
  }

  // Derived filtered projects
  const filteredProjects = projects.filter((p) => {
    const q = projectFilter.toLowerCase().trim();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.path.toLowerCase().includes(q) ||
      p.tags.some((t) => t.name.toLowerCase().includes(q))
    );
  });

  // Diff loading + selection
  async function loadFileDiff(filePath: string, isStaged: boolean) {
    if (!selectedProject) return;
    setDiffLoading(true);
    try {
      const diff: string = await invoke('get_diff', {
        repoPath: selectedProject.path,
        filePath,
        staged: isStaged,
      });
      setCurrentDiff(diff);
    } catch (e) {
      setCurrentDiff(`Error cargando diff: ${e}`);
    } finally {
      setDiffLoading(false);
    }
  }

  function closeDiff() {
    setSelectedFileForDiff(null);
    setCurrentDiff('');
  }

  async function stageFromDiff() {
    if (!selectedProject || !selectedFileForDiff) return;
    await invoke('stage_files', {
      repoPath: selectedProject.path,
      files: [selectedFileForDiff.path],
    });
    // Refresh the project and re-open the diff as now staged
    await loadProject(selectedProject);
    // Re-select as staged
    setSelectedFileForDiff({ path: selectedFileForDiff.path, staged: true, status: selectedFileForDiff.status });
    await loadFileDiff(selectedFileForDiff.path, true);
  }

  async function unstageFromDiff() {
    if (!selectedProject || !selectedFileForDiff) return;
    await invoke('unstage_files', {
      repoPath: selectedProject.path,
      files: [selectedFileForDiff.path],
    });
    await loadProject(selectedProject);
    setSelectedFileForDiff({ path: selectedFileForDiff.path, staged: false, status: selectedFileForDiff.status });
    await loadFileDiff(selectedFileForDiff.path, false);
  }

  function getAbsoluteProjectFilePath(relativePath: string) {
    if (!selectedProject) return null;
    const root = selectedProject.path.replace(/[\\/]+$/, '');
    const rel = relativePath.replace(/^[\\/]+/, '');
    const sep = root.includes('\\') ? '\\' : '/';
    const relNative = rel.replace(/\//g, sep);
    return `${root}${sep}${relNative}`;
  }

  function getPreviewKind(file: { path: string; status: string }) {
    if (file.status === 'deleted') {
      return undefined;
    }
    const ext = file.path.split('.').pop()?.toLowerCase() ?? '';

    if (imageExtensions.has(ext)) {
      return 'image' as const;
    }
    if (videoExtensions.has(ext)) {
      return 'video' as const;
    }
    if (audioExtensions.has(ext)) {
      return 'audio' as const;
    }
    if (pdfExtensions.has(ext)) {
      return 'pdf' as const;
    }

    const binaryExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'mp4', 'webm', 'mov', 'm4v', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'm4a', 'flac', 'pdf', 'zip', '7z', 'rar', 'dll', 'exe']);
    if (binaryExtensions.has(ext)) {
      return 'binary' as const;
    }

    return undefined;
  }

  useEffect(() => {
    let cancelled = false;

    const loadPreview = async () => {
      if (!selectedFileForDiff) {
        setPreview({ url: null });
        return;
      }

      const kind = getPreviewKind(selectedFileForDiff);
      if (!kind) {
        setPreview({ kind: undefined, url: null });
        return;
      }

      if (kind === 'binary') {
        setPreview({ kind, url: null });
        return;
      }

      const absolutePath = getAbsoluteProjectFilePath(selectedFileForDiff.path);
      if (!absolutePath) {
        setPreview({ kind: undefined, url: null });
        return;
      }

      if (cancelled) return;
      try {
        const url = convertFileSrc(absolutePath);
        setPreview({ kind, url });
      } catch (error) {
        console.error('preview load failed', error);
        setPreview({ kind: undefined, url: null });
      }
    };

    loadPreview();

    return () => {
      cancelled = true;
    };
  }, [selectedFileForDiff, selectedProject]);

  // Basic actions for the UI (simple git operations)
  async function stageAllUnstaged() {
    if (!selectedProject) return;
    const unstaged = changes.filter((c) => !c.staged).map((c) => c.path);
    if (unstaged.length === 0) return;

    await invoke('stage_files', { repoPath: selectedProject.path, files: unstaged });
    await refreshStatus();
  }

  async function unstageAll() {
    if (!selectedProject) return;
    const staged = changes.filter((c) => c.staged).map((c) => c.path);
    if (staged.length === 0) return;

    await invoke('unstage_files', { repoPath: selectedProject.path, files: staged });
    await refreshStatus();
  }

  function startResize(key: ResizableColumnKey, event: React.MouseEvent<HTMLDivElement>) {
    dragRef.current = {
      key,
      startX: event.clientX,
      startWidth: columnWidths[key],
    };
    setIsResizing(true);
  }

  function renderResizeHandle(key: ResizableColumnKey) {
    return (
      <div
        onMouseDown={(event) => startResize(key, event)}
        className="w-1.5 h-full flex-shrink-0 cursor-col-resize bg-[#1a1a1d] hover:bg-violet-500/60 active:bg-violet-500/80 transition-colors"
        title="Drag to resize"
      />
    );
  }

  function parseArgs(input: string) {
    const matches = input.match(/"([^"]*)"|'([^']*)'|[^\s]+/g) ?? [];
    return matches.map((token) => token.replace(/^['"]|['"]$/g, ''));
  }

  async function runGit(args: string[], label: string, refreshAfter = true) {
    if (!selectedProject || args.length === 0) return;
    setIsLoading(true);
    setStatusMsg(`${label}...`);

    try {
      const result = await invoke<CommandResult>('run_git_command', {
        repoPath: selectedProject.path,
        args,
      });

      if (!result.success) {
        throw new Error(result.stderr || result.stdout || `${label} failed`);
      }

      if (refreshAfter) {
        await refreshStatus();
      }

      const detail = result.stdout || result.stderr || 'OK';
      setStatusMsg(`✅ ${label}: ${detail.slice(0, 120)}`);
    } catch (err: any) {
      setStatusMsg(`Error ${label}: ${err?.message || err}`);
    } finally {
      setIsLoading(false);
      setTimeout(() => setStatusMsg(''), 4000);
    }
  }

  async function runPromptedGit(label: string, promptText: string, refreshAfter = true) {
    const raw = prompt(promptText);
    if (!raw?.trim()) return;
    await runGit(parseArgs(raw.trim()), label, refreshAfter);
  }

  async function stageFile(path: string) {
    if (!selectedProject) return;
    await invoke('stage_files', { repoPath: selectedProject.path, files: [path] });
    await refreshStatus();
  }

  async function unstageFile(path: string) {
    if (!selectedProject) return;
    await invoke('unstage_files', { repoPath: selectedProject.path, files: [path] });
    await refreshStatus();
  }

  async function addRemote() {
    if (!selectedProject) return;
    const name = prompt('Remote name?');
    if (!name?.trim()) return;
    const url = prompt(`URL for remote ${name.trim()}?`);
    if (!url?.trim()) return;
    await invoke('add_remote', { repoPath: selectedProject.path, name: name.trim(), url: url.trim() });
    await loadProject(selectedProject);
  }

  async function editRemote(remote: string) {
    if (!selectedProject) return;
    const currentUrl = await invoke<string>('get_remote_url', { repoPath: selectedProject.path, name: remote });
    const nextUrl = prompt(`New URL for remote ${remote}?`, currentUrl);
    if (!nextUrl?.trim() || nextUrl.trim() === currentUrl) return;
    await invoke('set_remote_url', { repoPath: selectedProject.path, name: remote, url: nextUrl.trim() });
    await loadProject(selectedProject);
  }

  async function addTag() {
    if (!selectedProject) return;
    const tag = prompt('New tag name?');
    if (!tag?.trim()) return;
    await invoke('create_tag', { repoPath: selectedProject.path, tag: tag.trim() });
    await loadProject(selectedProject);
  }

  async function createStash() {
    if (!selectedProject) return;
    const message = prompt('Stash message? (optional)');
    await invoke('create_stash', { repoPath: selectedProject.path, message: message?.trim() || null });
    await loadProject(selectedProject);
  }

  async function discardFile(file: FileChange) {
    if (!selectedProject) return;
    if (!confirm(`Discard changes in ${file.path}?`)) return;
    await invoke('discard_file_changes', { repoPath: selectedProject.path, filePath: file.path });
    await refreshStatus();
  }

  async function deleteUntrackedFile(file: FileChange) {
    if (!selectedProject) return;
    if (!confirm(`Delete untracked file ${file.path}?`)) return;
    await invoke('delete_untracked_file', { repoPath: selectedProject.path, filePath: file.path });
    await refreshStatus();
  }

  async function gitFetchAll() {
    await runGit(['fetch', '--all', '--prune'], 'fetch');
  }

  async function gitPull() {
    await runGit(['pull', '--ff-only'], 'pull');
  }

  async function gitPush() {
    await runGit(['push'], 'push');
  }

  async function gitMerge() {
    const branch = prompt('Merge branch/ref into current branch?');
    if (!branch?.trim()) return;
    await runGit(['merge', branch.trim()], 'merge');
  }

  async function gitRebase() {
    const upstream = prompt('Rebase current branch onto which branch/ref?');
    if (!upstream?.trim()) return;
    await runGit(['rebase', upstream.trim()], 'rebase');
  }

  async function gitCherryPick() {
    const commit = prompt('Cherry-pick commit hash?');
    if (!commit?.trim()) return;
    await runGit(['cherry-pick', commit.trim()], 'cherry-pick');
  }

  async function gitRevert() {
    const commit = prompt('Revert commit hash?');
    if (!commit?.trim()) return;
    await runGit(['revert', commit.trim()], 'revert');
  }

  async function gitReset() {
    await runPromptedGit(
      'reset',
      'git reset args?\nExamples:\n--soft HEAD~1\n--mixed HEAD~1\n--hard origin/main'
    );
  }

  async function gitClean() {
    if (!confirm('Remove untracked files and directories? (git clean -fd)')) return;
    await runGit(['clean', '-fd'], 'clean');
  }

  async function gitWorktree() {
    await runPromptedGit(
      'worktree',
      'git worktree args?\nExamples:\nadd ../repo-hotfix hotfix\nlist\nremove ../repo-hotfix',
      false,
    );
  }

  async function gitSubmodule() {
    await runPromptedGit(
      'submodule',
      'git submodule args?\nExamples:\nupdate --init --recursive\nforeach git status',
      false,
    );
  }

  async function gitCustom() {
    await runPromptedGit(
      'git',
      'Git args?\nExamples:\nshow HEAD~1\nlog --oneline -20\nbranch -vv\nremote -v'
    );
  }

  async function doCommit(message: string) {
    if (!selectedProject || !message.trim()) return;
    try {
      setIsLoading(true);
      setStatusMsg('Haciendo commit...');
      const result: string = await invoke('commit_changes', {
        repoPath: selectedProject.path,
        message: message.trim(),
      });
      setStatusMsg(`✅ ${result || 'Commit realizado'}`);
      await loadProject(selectedProject);
      setTimeout(() => setStatusMsg(''), 3000);
    } catch (err: any) {
      setStatusMsg('Error commit: ' + err);
    } finally {
      setIsLoading(false);
    }
  }

  async function doCommitAndPush(message: string) {
    if (!selectedProject || !message.trim()) return;
    try {
      setIsLoading(true);
      setStatusMsg('Commit...');
      await invoke('commit_changes', {
        repoPath: selectedProject.path,
        message: message.trim(),
      });
      setStatusMsg('Push...');
      await invoke('fetch', { repoPath: selectedProject.path }); // or better push, but we can call shell for full
      // For simplicity, suggest user does push in terminal, or we can add a push command later
      setStatusMsg('✅ Commit hecho. Usa el terminal para push o agrega comando push.');
      await loadProject(selectedProject);
    } catch (err: any) {
      setStatusMsg('Error: ' + err);
    } finally {
      setIsLoading(false);
      setTimeout(() => setStatusMsg(''), 4000);
    }
  }

  async function fixUnsafeProject(proj: Project) {
    try {
      setIsLoading(true);
      setStatusMsg('Adding safe.directory exception...');
      await invoke('add_safe_directory', { path: proj.path });
      setStatusMsg('Exception added.');
      // update local project list
      setProjects(prev => prev.map(p => p.id === proj.id ? {...p, is_unsafe: false} : p));
      if (selectedProject?.id === proj.id) {
        const updated = {...selectedProject, is_unsafe: false};
        setSelectedProject(updated);
        await loadProject(updated);
      }
    } catch (err: any) {
      setStatusMsg('Error adding exception: ' + err);
    } finally {
      setIsLoading(false);
      setTimeout(() => setStatusMsg(''), 3000);
    }
  }

  function renderTag(tag: { name: string; color: string }) {
    const className = `tag tag-${tag.name.toLowerCase().replace(/[^a-z]/g, '')}`;
    return (
      <span key={tag.name} className={className} style={{ background: tag.color, color: '#fff' }}>
        {tag.name}
      </span>
    );
  }

  function getProjectCardTone(project: Project) {
    if (project.is_unsafe) {
      return 'border-red-700/70 bg-red-950/30 hover:border-red-600';
    }

    if (project.git_status?.is_dirty) {
      return 'border-amber-700/70 bg-amber-950/25 hover:border-amber-600';
    }

    if ((project.git_status?.ahead ?? 0) > 0) {
      return 'border-sky-700/70 bg-sky-950/25 hover:border-sky-600';
    }

    return '';
  }

  return (
    <div className="h-screen flex flex-col bg-[#18181b] text-[#e5e5e5] overflow-hidden">
      {/* Top Bar */}
      <div className="h-14 border-b border-[#2a2a2f] flex items-center px-4 justify-between bg-[#111113] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="text-2xl">🥄</span> Spoon
          </div>
          <div className="text-xs px-2 py-0.5 bg-[#26262b] rounded text-zinc-400">Git + AI Terminal</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenDirectory}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-1.5 rounded-md bg-white/10 hover:bg-white/15 active:bg-white/20 transition text-sm font-medium disabled:opacity-50"
            title="Open directory"
          >
            <FolderOpen size={16} /> Abrir Directorio
          </button>

          <div className="flex items-center bg-[#1a1a1d] rounded-md border border-[#2a2a2f]">
            {selectedProject && (
              <button
                onClick={refreshStatus}
                disabled={isLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm hover:bg-white/10 rounded-l-md rounded-r-md transition"
                title="Refresh current project"
              >
                <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} /> Refresh
              </button>
            )}
          </div>
        </div>

        <div className="text-xs text-zinc-500 min-w-[160px] text-right">{statusMsg}</div>
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* Main Content */}
        <div className="flex-1 h-full flex flex-col overflow-hidden">
          {!selectedProject ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="text-7xl mb-6 opacity-80">🥄</div>
              <h1 className="text-4xl font-semibold tracking-tighter mb-2">Bienvenido a Spoon</h1>
              <p className="max-w-md text-zinc-400 mb-8">
                Carga una carpeta con tus proyectos. Verás los archivos modificados, diffs, y una terminal PowerShell interactiva.
                Inicia agentes de IA (Claude, Codex, Grok...) y usa el botón para inyectar prompts que analicen cambios, hagan commit en inglés y push.
              </p>
              <button
                onClick={handleOpenDirectory}
                className="flex items-center gap-3 px-8 py-3 bg-violet-600 hover:bg-violet-500 active:bg-violet-700 transition rounded-xl text-lg font-medium shadow-lg"
              >
                <FolderOpen /> Seleccionar carpeta de proyectos
              </button>
              <p className="text-[10px] text-zinc-500 mt-8">Soporta Windows, macOS y Linux • 100% local • Privado</p>
            </div>
          ) : (
            <>
              {/* Project Header - minimal now, controls moved to top bar */}
              <div className="border-b border-[#2a2a2f] px-4 py-2 bg-[#111113] flex-shrink-0">
                <div className="flex items-center gap-4">
                  <div>
                  <span className="font-semibold text-lg">{selectedProject.name}</span>
                  <span className="ml-3 text-xs text-zinc-500">{selectedProject.path}</span>
                  </div>
                  <div className="flex-1" />
                  <div className="flex items-center gap-2 text-sm">
                    {branches.find((b) => b.is_current) && (
                      <div className="px-2.5 py-px rounded bg-emerald-900/60 text-emerald-400 flex items-center gap-1">
                        <GitBranch size={14} /> {branches.find((b) => b.is_current)?.name}
                      </div>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button onClick={gitFetchAll} className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/15 rounded">fetch</button>
                  <button onClick={gitPull} className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/15 rounded">pull</button>
                  <button onClick={gitPush} className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/15 rounded">push</button>
                  <button onClick={gitMerge} className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/15 rounded">merge</button>
                  <button onClick={gitRebase} className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/15 rounded">rebase</button>
                  <button onClick={gitCherryPick} className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/15 rounded">pick</button>
                  <button onClick={gitRevert} className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/15 rounded">revert</button>
                  <button onClick={gitReset} className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/15 rounded">reset</button>
                  <button onClick={gitClean} className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/15 rounded">clean</button>
                  <button onClick={gitWorktree} className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/15 rounded">worktree</button>
                  <button onClick={gitSubmodule} className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/15 rounded">submodule</button>
                  <button onClick={gitCustom} className="text-[10px] px-2 py-0.5 bg-violet-700/80 hover:bg-violet-700 rounded">git...</button>
                </div>
              </div>

              {selectedProject?.is_unsafe && (
                <div className="bg-red-900/30 border-b border-red-800 px-4 py-2 text-xs flex items-center justify-between text-red-300 flex-shrink-0">
                  <span>⚠️ This repo is marked unsafe (dubious ownership detected). Some Git operations may fail.</span>
                  <button 
                    onClick={() => fixUnsafeProject(selectedProject)} 
                    className="bg-red-700 hover:bg-red-600 px-3 py-1 rounded text-xs text-white font-medium"
                  >
                    Add safe.directory exception
                  </button>
                </div>
              )}

              {/* Main layout with projects column (left, with buscador) + files + right (diff+ps) */}
              <div className="flex h-full flex-1 overflow-x-auto overflow-y-hidden bg-[#111113] relative">
                {/* Side tab always visible for projects column toggle */}
                <div 
                  onClick={() => setShowProjectsSidebar(!showProjectsSidebar)}
                  className="w-6 h-full bg-[#1a1a1d] border-r border-[#2a2a2f] flex items-center justify-center cursor-pointer hover:bg-white/5"
                  title={showProjectsSidebar ? "Hide projects" : "Show projects"}
                >
                  <span className="text-[10px] -rotate-90 tracking-[2px] font-medium text-zinc-400">
                    {showProjectsSidebar ? "HIDE" : "PROJECTS"}
                  </span>
                </div>

                {showProjectsSidebar && (
                  <div
                    className="min-h-0 flex-shrink-0 border-r border-[#2a2a2f] bg-[#1a1a1d] flex flex-col h-full overflow-hidden"
                    style={{ width: columnWidths.projects }}
                  >
                    <div className="p-3 border-b flex-shrink-0">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-semibold">PROJECTS</span>
                        <div className="flex items-center gap-2">
                          <label className="text-[10px] flex items-center gap-1 cursor-pointer">
                            <input type="checkbox" checked={autoHideProjects} onChange={(e) => setAutoHideProjects(e.target.checked)} /> autohide
                          </label>
                          <button onClick={() => setShowProjectsSidebar(false)} className="text-xs px-1.5 py-0.5 bg-white/10 rounded hover:bg-white/20">hide</button>
                        </div>
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          value={projectFilter}
                          onChange={(e) => setProjectFilter(e.target.value)}
                          placeholder="Buscar proyectos..."
                          className="w-full bg-[#111113] border border-[#2a2a2f] focus:border-violet-500 rounded-md pl-8 pr-3 py-1.5 text-sm placeholder:text-zinc-500"
                        />
                        <Search size={15} className="absolute left-2.5 top-2.5 text-zinc-400" />
                      </div>
                      <div className="px-1 text-[10px] text-zinc-400 mt-1">
                        {projectFilter ? `(${filteredProjects.length}/${projects.length})` : `(${projects.length})`}
                      </div>
                    </div>

                    {filteredProjects.length === 0 && projects.length > 0 && (
                      <div className="p-4 text-sm text-zinc-400 flex-shrink-0">No matches.</div>
                    )}

                    <div className="min-h-0 flex-1 overflow-auto p-3 space-y-2">
                      {filteredProjects.map((proj) => (
                        <div
                          key={proj.id}
                          onClick={() => {
                            loadProject(proj);
                            if (autoHideProjects) setShowProjectsSidebar(false);
                          }}
                          className={`project-card cursor-pointer text-xs ${getProjectCardTone(proj)} ${selectedProject?.id === proj.id ? 'ring-2 ring-violet-500' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="font-medium truncate">{proj.name}</div>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {proj.git_status?.is_dirty && (
                                <span className="tag" style={{ background: '#92400e', color: '#fef3c7' }}>
                                  dirty {proj.git_status.changed_files}
                                </span>
                              )}
                              {(proj.git_status?.ahead ?? 0) > 0 && (
                                <span className="tag" style={{ background: '#075985', color: '#e0f2fe' }}>
                                  push {proj.git_status?.ahead}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="repo-path text-[10px] mb-1 truncate">{proj.path}</div>
                          <div className="flex gap-1 items-center">
                            {proj.tags.slice(0,3).map(renderTag)}
                            {proj.is_unsafe && (
                              <>
                                <span className="tag" style={{background: '#7f1d1d', color: '#fecaca'}}>unsafe</span>
                                <button 
                                  onClick={(e) => { e.stopPropagation(); fixUnsafeProject(proj); }}
                                  className="text-[10px] px-1 py-0 bg-red-700 hover:bg-red-600 text-white rounded"
                                  title={`Run: git config --global --add safe.directory ${proj.path.replace(/\\/g, '/')}`}
                                >
                                  fix
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {showProjectsSidebar && renderResizeHandle('projects')}

                {/* Refs column stays visible even when projects are hidden */}
                <div
                  className="min-h-0 flex-shrink-0 border-r border-[#2a2a2f] bg-[#1a1a1d] flex flex-col h-full overflow-hidden text-sm"
                  style={{ width: columnWidths.refs }}
                >
                  <div className="min-h-0 flex-1 overflow-auto p-2">
                    <div className="p-2 text-xs font-semibold text-zinc-400 border-b border-[#2a2a2f]">LOCAL BRANCHES</div>
                    <div className="p-1 space-y-0.5">
                      {branches.filter(b => !b.is_remote).length === 0 && <div className="px-2 py-1 text-xs text-zinc-500">No local branches</div>}
                      {branches.filter(b => !b.is_remote).map((b) => (
                        <div key={b.name} className={`group flex items-center justify-between px-2 py-1 rounded text-xs ${b.is_current ? 'bg-emerald-900/50 text-emerald-300 font-medium' : 'hover:bg-white/5'}`}>
                          <span onClick={async () => {
                            if (!selectedProject || b.is_current) return;
                            await invoke('checkout_branch', { repoPath: selectedProject.path, branch: b.name });
                            await loadProject(selectedProject);
                          }} className="cursor-pointer flex-1 truncate">{b.name}</span>
                          {!b.is_current && (
                            <button onClick={async (e) => { e.stopPropagation(); if (!selectedProject) return; if (confirm(`Delete branch ${b.name}?`)) { await invoke('delete_local_branch', {repoPath: selectedProject.path, branch: b.name}); await loadProject(selectedProject); } }} className="opacity-60 group-hover:opacity-100 text-red-400 hover:text-red-300 px-1">✕</button>
                          )}
                        </div>
                      ))}
                      <button onClick={async () => {
                        if (!selectedProject) return;
                        const name = prompt('New branch name?');
                        if (name) { await invoke('create_branch', {repoPath: selectedProject.path, branch: name}); await loadProject(selectedProject); }
                      }} className="text-xs text-violet-400 hover:text-violet-300 mt-1 block">+ New branch</button>
                    </div>

                    <div className="p-2 text-xs font-semibold text-zinc-400 border-t border-b border-[#2a2a2f]">REMOTES</div>
                    <div className="p-1 space-y-0.5">
                      <button onClick={addRemote} className="text-xs text-violet-400 hover:text-violet-300 mb-1 block">+ Add remote</button>
                      {remotes.length === 0 ? <div className="px-2 py-1 text-xs text-zinc-500">No remotes</div> : remotes.map(r => (
                        <div key={r} className="group flex items-center justify-between px-2 py-1 rounded text-xs hover:bg-white/5">
                          <span>{r}</span>
                          <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100">
                            <button onClick={async (e) => { e.stopPropagation(); await editRemote(r); }} className="text-[10px] text-sky-400">edit</button>
                            <button onClick={async (e) => { e.stopPropagation(); if (!selectedProject || !confirm(`Remove remote ${r}?`)) return; await invoke('delete_remote', {repoPath: selectedProject.path, remote: r}); await loadProject(selectedProject); }} className="text-red-400 px-1">✕</button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="p-2 text-xs font-semibold text-zinc-400 border-t border-b border-[#2a2a2f]">TAGS</div>
                    <div className="p-1 space-y-0.5">
                      <button onClick={addTag} className="text-xs text-violet-400 hover:text-violet-300 mb-1 block">+ New tag</button>
                      {tags.length === 0 && <div className="px-2 py-1 text-xs text-zinc-500">No tags</div>}
                      {tags.map((t, i) => (
                        <div key={i} className="group flex items-center justify-between px-2 py-0.5 text-xs hover:bg-white/5 rounded cursor-pointer truncate">
                          <span onClick={async () => {
                            if (!selectedProject) return;
                            if (confirm(`Checkout tag ${t} (detached)?`)) {
                              await invoke('checkout_branch', {repoPath: selectedProject.path, branch: t});
                              await loadProject(selectedProject);
                            }
                          }}>{t}</span>
                          <button onClick={async (e) => { e.stopPropagation(); if (!selectedProject || !confirm(`Delete tag ${t}?`)) return; await invoke('delete_tag', {repoPath: selectedProject.path, tag: t}); await loadProject(selectedProject); }} className="opacity-60 group-hover:opacity-100 text-red-400 px-1">✕</button>
                        </div>
                      ))}
                    </div>

                    <div className="p-2 text-xs font-semibold text-zinc-400 border-t border-b border-[#2a2a2f]">STASHES</div>
                    <div className="p-1 space-y-0.5">
                      <button onClick={createStash} className="text-xs text-violet-400 hover:text-violet-300 mb-1 block">+ Create stash</button>
                      {stashes.length === 0 && <div className="px-2 py-1 text-xs text-zinc-500">No stashes</div>}
                      {stashes.map((s, i) => (
                        <div key={i} className="group flex items-center justify-between px-2 py-0.5 text-xs hover:bg-white/5 rounded cursor-pointer truncate">
                          <span title={s}>{s}</span>
                          <div className="flex gap-1 opacity-60 group-hover:opacity-100">
                            <button onClick={async (e) => { e.stopPropagation(); if (!selectedProject) return; await invoke('stash_apply', {repoPath: selectedProject.path, stash_ref: s.split(' ')[0]}); await loadProject(selectedProject); }} className="text-[10px] text-blue-400">apply</button>
                            <button onClick={async (e) => { e.stopPropagation(); if (!selectedProject) return; await invoke('stash_pop', {repoPath: selectedProject.path, stash_ref: s.split(' ')[0]}); await loadProject(selectedProject); }} className="text-[10px] text-green-400">pop</button>
                            <button onClick={async (e) => { e.stopPropagation(); if (!selectedProject || !confirm('Drop stash?')) return; await invoke('stash_drop', {repoPath: selectedProject.path, stash_ref: s.split(' ')[0]}); await loadProject(selectedProject); }} className="text-[10px] text-red-400">drop</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                {renderResizeHandle('refs')}

                {/* Files column */}
                <div
                  className="h-full flex-shrink-0 border-r border-[#2a2a2f] bg-[#1a1a1d] flex flex-col overflow-hidden"
                  style={{ width: columnWidths.files }}
                >
                  <div className="px-3 py-2 text-xs font-semibold text-zinc-400 flex items-center justify-between border-b border-[#2a2a2f]">
                    MODIFIED FILES ({changes.length})
                    <div className="flex gap-1">
                      <button onClick={createStash} className="px-2 py-0.5 text-[10px] bg-violet-700/80 hover:bg-violet-700 rounded">Stash all</button>
                      <button onClick={stageAllUnstaged} className="px-2 py-0.5 text-[10px] bg-emerald-700/80 hover:bg-emerald-700 rounded">Stage all</button>
                      <button onClick={unstageAll} className="px-2 py-0.5 text-[10px] bg-orange-700/80 hover:bg-orange-700 rounded">Unstage all</button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-auto p-2 text-sm custom-scrollbar space-y-1">
                    {changes.length === 0 && <div className="p-4 text-xs text-zinc-400">No changes.</div>}
                    {changes.map((file) => (
                      <div
                        key={file.path}
                        onClick={() => {
                          const sel = { path: file.path, staged: file.staged, status: file.status };
                          setSelectedFileForDiff(sel);
                          loadFileDiff(file.path, file.staged);
                        }}
                        className={`p-2 rounded text-xs flex justify-between cursor-pointer ${selectedFileForDiff?.path === file.path ? 'bg-violet-500/20 ring-1 ring-violet-500' : 'hover:bg-white/5'} ${file.status === 'deleted' ? 'opacity-60' : ''}`}
                      >
                        <div className={`font-mono truncate pr-2 ${file.status === 'deleted' ? 'line-through text-zinc-500' : file.status === 'untracked' ? 'text-emerald-300' : file.status === 'modified' ? 'text-amber-200' : 'text-zinc-200'}`}>
                          {file.path}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <span className={`px-1 rounded ${
                            file.status === 'deleted'
                              ? 'bg-zinc-800 text-zinc-300'
                              : file.status === 'untracked'
                                ? 'bg-emerald-900 text-emerald-300'
                                : file.status === 'modified'
                                  ? 'bg-amber-800 text-amber-300'
                                  : file.staged
                                    ? 'bg-sky-800 text-sky-300'
                                    : 'bg-white/10 text-zinc-300'
                          }`}>{file.status}</span>
                          <button onClick={(e) => { e.stopPropagation(); file.staged ? unstageFile(file.path) : stageFile(file.path); }} className="px-1.5 bg-white/10 rounded text-[10px]">{file.staged ? 'Un' : 'Stage'}</button>
                          {file.status === 'untracked' ? (
                            <button onClick={(e) => { e.stopPropagation(); deleteUntrackedFile(file); }} className="px-1.5 bg-red-900/60 text-red-300 rounded text-[10px]">Delete</button>
                          ) : (
                            <button onClick={(e) => { e.stopPropagation(); discardFile(file); }} className="px-1.5 bg-red-900/60 text-red-300 rounded text-[10px]">Discard</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Quick commit */}
                  <div className="p-3 border-t border-[#2a2a2f] bg-[#1a1a1d]">
                    <div className="text-[10px] mb-1 text-zinc-400">Commit message</div>
                    <textarea id="quick-commit-msg" className="w-full h-14 bg-[#111113] border border-[#2a2a2f] rounded p-2 text-xs font-mono" placeholder="feat: ..." />
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => { const ta = document.getElementById('quick-commit-msg') as HTMLTextAreaElement | null; if (ta?.value) doCommit(ta.value); }} className="flex-1 py-1 text-xs bg-emerald-600 hover:bg-emerald-500 rounded">Commit</button>
                      <button onClick={() => { const ta = document.getElementById('quick-commit-msg') as HTMLTextAreaElement | null; if (ta?.value) doCommitAndPush(ta.value); }} className="flex-1 py-1 text-xs bg-white/10 hover:bg-white/15 rounded">Commit &amp; Push</button>
                    </div>
                  </div>
                </div>
                {renderResizeHandle('files')}

                {/* Diff center + PowerShell right */}
                <div className="flex-1 min-w-0 h-full flex overflow-hidden">
                  <div
                    className="overflow-auto bg-[#111113] flex-shrink-0"
                    style={{ width: columnWidths.diff }}
                  >
                    {selectedFileForDiff ? (
                      <DiffViewer
                        filePath={selectedFileForDiff.path}
                        staged={selectedFileForDiff.staged}
                        status={selectedFileForDiff.status}
                        diff={currentDiff}
                        onStage={stageFromDiff}
                        onUnstage={unstageFromDiff}
                        onClose={closeDiff}
                        isLoading={diffLoading}
                        previewKind={preview.kind}
                        previewUrl={preview.url}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-zinc-400 text-sm p-4 text-center">Click a file to view diff</div>
                    )}
                  </div>
                  {renderResizeHandle('diff')}
                  <div
                    className="h-full min-w-[20rem] flex-1 border-l border-[#2a2a2f] bg-[#111113]"
                  >
                    <AITerminal repoPath={selectedProject.path} cliCommands={cliCommands} />
                  </div>
                </div>

              </div>
            </>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="h-6 bg-[#0a0a0b] border-t border-[#2a2a2f] px-3 text-[10px] flex items-center text-zinc-500">
        {selectedProject ? `Proyecto: ${selectedProject.name}` : 'Sin proyecto seleccionado'} • {projects.length} repos detectados
      </div>
    </div>
  );
}

export default App;
