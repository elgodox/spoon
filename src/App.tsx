import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import {
  DragDropContext,
  Droppable,
  Draggable,
  DropResult,
} from '@hello-pangea/dnd';
import { FolderOpen, RefreshCw, GitBranch, GitCommit, Play, X, Search } from 'lucide-react';

import {
  Project,
  GitBranch as GitBranchType,
  GitCommit as GitCommitType,
  FileChange,
  ChangeCard,
  CommitGroup,
} from './types';
import DiffViewer from './components/DiffViewer';
import { CommitGraph } from './components/CommitGraph';
import './App.css';

const UNSTAGED_ID = 'unstaged';
const STAGED_ID = 'staged';

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [commits, setCommits] = useState<GitCommitType[]>([]);
  const [, setChanges] = useState<FileChange[]>([]);

  // Kanban state: groups of commits (Trello lists)
  const [commitGroups, setCommitGroups] = useState<CommitGroup[]>([
    { id: 'group-1', title: 'Primer commit', cards: [] },
  ]);

  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');

  // Project filter / search
  const [projectFilter, setProjectFilter] = useState('');

  // Diff viewer state
  const [selectedFileForDiff, setSelectedFileForDiff] = useState<{ path: string; staged: boolean } | null>(null);
  const [currentDiff, setCurrentDiff] = useState('');
  const [diffLoading, setDiffLoading] = useState(false);

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
      const cms = (await invoke('get_commit_log', { repoPath: project.path, limit: 40 })) as GitCommitType[];
      const chgs = (await invoke('get_file_changes', { repoPath: project.path })) as FileChange[];

      setBranches(brs);
      setCommits(cms);
      setChanges(chgs);

      // Keep diff viewer open if the file is still there (update staged flag)
      if (selectedFileForDiff) {
        const stillThere = chgs.find((c) => c.path === selectedFileForDiff.path);
        if (stillThere) {
          const newSel = { path: stillThere.path, staged: stillThere.staged };
          setSelectedFileForDiff(newSel);
          // fire and forget reload of diff with new staged state
          loadFileDiff(stillThere.path, stillThere.staged);
        } else {
          closeDiff();
        }
      }

      // Separate staged vs unstaged properly
      const unstagedCards: ChangeCard[] = chgs
        .filter((c) => !c.staged)
        .map((c, idx) => ({ id: `unstaged-${idx}`, file: c }));

      const stagedCards: ChangeCard[] = chgs
        .filter((c) => c.staged)
        .map((c, idx) => ({ id: `staged-${idx}`, file: c }));

      setCommitGroups([
        { id: UNSTAGED_ID, title: 'Cambios sin stage', cards: unstagedCards },
        { id: 'group-1', title: 'Mi commit #1', cards: [] },
        { id: STAGED_ID, title: 'Staged (listos para commit)', cards: stagedCards },
      ]);
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

  function selectFileForDiff(file: FileChange) {
    setSelectedFileForDiff({ path: file.path, staged: file.staged });
    loadFileDiff(file.path, file.staged);
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
    // Refresh the project (rebuilds kanban) and re-open the diff as now staged
    await loadProject(selectedProject);
    // Re-select as staged
    setSelectedFileForDiff({ path: selectedFileForDiff.path, staged: true });
    await loadFileDiff(selectedFileForDiff.path, true);
  }

  async function unstageFromDiff() {
    if (!selectedProject || !selectedFileForDiff) return;
    await invoke('unstage_files', {
      repoPath: selectedProject.path,
      files: [selectedFileForDiff.path],
    });
    await loadProject(selectedProject);
    setSelectedFileForDiff({ path: selectedFileForDiff.path, staged: false });
    await loadFileDiff(selectedFileForDiff.path, false);
  }

  // Drag end handler - core of the Trello-like grouping
  function onDragEnd(result: DropResult) {
    const { source, destination } = result;
    if (!destination) return;

    // Reorder or move between lists
    setCommitGroups((prevGroups) => {
      const newGroups = [...prevGroups];

      const sourceGroupIndex = newGroups.findIndex(g => g.id === source.droppableId);
      const destGroupIndex = newGroups.findIndex(g => g.id === destination.droppableId);

      if (sourceGroupIndex === -1 || destGroupIndex === -1) return prevGroups;

      const sourceGroup = { ...newGroups[sourceGroupIndex] };
      const destGroup = { ...newGroups[destGroupIndex] };

      const [moved] = sourceGroup.cards.splice(source.index, 1);
      destGroup.cards.splice(destination.index, 0, moved);

      newGroups[sourceGroupIndex] = sourceGroup;
      newGroups[destGroupIndex] = destGroup;

      return newGroups;
    });
  }

  // Add a new commit group (like adding a list in Trello)
  function addCommitGroup() {
    const newId = `group-${Date.now()}`;
    setCommitGroups((g) => [
      ...g,
      { id: newId, title: `Commit ${g.length}`, cards: [] },
    ]);
  }

  function updateGroupTitle(groupId: string, newTitle: string) {
    setCommitGroups((groups) =>
      groups.map((g) => (g.id === groupId ? { ...g, title: newTitle } : g))
    );
  }

  function removeGroup(groupId: string) {
    if (groupId === UNSTAGED_ID || groupId === STAGED_ID) return; // protect core lists
    setCommitGroups((groups) => groups.filter((g) => g.id !== groupId));
  }

  // Commit a specific group
  async function commitGroup(group: CommitGroup) {
    if (!selectedProject) return;
    if (group.cards.length === 0) {
      setStatusMsg('No hay archivos en este grupo');
      return;
    }

    const files = group.cards.map((c) => c.file.path);

    try {
      setIsLoading(true);
      setStatusMsg(`Staging ${files.length} archivos...`);

      await invoke('stage_files', {
        repoPath: selectedProject.path,
        files,
      });

      setStatusMsg('Haciendo commit...');
      const result: string = await invoke('commit_changes', {
        repoPath: selectedProject.path,
        message: group.title.trim(),
        files: null, // already staged
      });

      setStatusMsg(`✅ ${result || 'Commit exitoso'}`);

      // Refresh everything
      await loadProject(selectedProject);
    } catch (err: any) {
      setStatusMsg(`Error en commit: ${err}`);
    } finally {
      setIsLoading(false);
      setTimeout(() => setStatusMsg(''), 4000);
    }
  }

  async function stageAllUnstaged() {
    if (!selectedProject) return;
    const unstaged = commitGroups.find(g => g.id === UNSTAGED_ID)?.cards.map(c => c.file.path) || [];
    if (unstaged.length === 0) return;

    await invoke('stage_files', { repoPath: selectedProject.path, files: unstaged });
    await refreshStatus();
  }

  async function unstageGroup(groupId: string) {
    if (!selectedProject) return;
    const group = commitGroups.find((g) => g.id === groupId);
    if (!group || group.cards.length === 0) return;

    const files = group.cards.map((c) => c.file.path);
    await invoke('unstage_files', { repoPath: selectedProject.path, files });
    await refreshStatus();
  }

  function renderTag(tag: { name: string; color: string }) {
    const className = `tag tag-${tag.name.toLowerCase().replace(/[^a-z]/g, '')}`;
    return (
      <span key={tag.name} className={className} style={{ background: tag.color, color: '#fff' }}>
        {tag.name}
      </span>
    );
  }

  const currentUnstaged = commitGroups.find((g) => g.id === UNSTAGED_ID)?.cards.length || 0;

  return (
    <div className="h-screen flex flex-col bg-[#18181b] text-[#e5e5e5] overflow-hidden">
      {/* Top Bar */}
      <div className="h-14 border-b border-[#2a2a2f] flex items-center px-4 justify-between bg-[#111113] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="text-2xl">🥄</span> Spoon
          </div>
          <div className="text-xs px-2 py-0.5 bg-[#26262b] rounded text-zinc-400">Git × Trello</div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenDirectory}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-1.5 rounded-md bg-white/10 hover:bg-white/15 active:bg-white/20 transition text-sm font-medium disabled:opacity-50"
          >
            <FolderOpen size={16} /> Abrir Directorio
          </button>

          {selectedProject && (
            <button
              onClick={refreshStatus}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-sm"
            >
              <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} /> Refrescar
            </button>
          )}
        </div>

        <div className="text-xs text-zinc-500 min-w-[160px] text-right">{statusMsg}</div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Projects Sidebar */}
        <div className="w-80 border-r border-[#2a2a2f] flex flex-col bg-[#1a1a1d] overflow-y-auto">
          <div className="px-3 py-2 border-b border-[#2a2a2f]">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="flex-1 relative">
                <input
                  type="text"
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  placeholder="Buscar proyectos (nombre, path o tag)..."
                  className="w-full bg-[#111113] border border-[#2a2a2f] focus:border-violet-500 rounded-md pl-8 pr-3 py-1.5 text-sm placeholder:text-zinc-500 outline-none"
                />
                <Search size={15} className="absolute left-2.5 top-2.5 text-zinc-400" />
              </div>
              {projectFilter && (
                <button
                  onClick={() => setProjectFilter('')}
                  className="text-xs px-2 py-1 bg-white/5 rounded hover:bg-white/10"
                >
                  ✕
                </button>
              )}
            </div>
            <div className="px-1 text-[10px] text-zinc-400 flex items-center justify-between">
              <span>
                PROYECTOS {projectFilter ? `(${filteredProjects.length}/${projects.length})` : `(${projects.length})`}
              </span>
              {isLoading && <RefreshCw size={12} className="animate-spin" />}
            </div>
          </div>

          {filteredProjects.length === 0 && projects.length > 0 && (
            <div className="p-4 text-sm text-zinc-400">No se encontraron proyectos con ese filtro.</div>
          )}

          {projects.length === 0 && (
            <div className="p-6 text-sm text-zinc-400">
              Haz clic en <span className="font-medium text-white">"Abrir Directorio"</span> para escanear tus proyectos locales.
              <div className="mt-4 text-[11px]">
                Spoon detectará automáticamente Unity, C#, Python, Rust, Node, Go y muchos más.
              </div>
            </div>
          )}

          <div className="p-3 space-y-2">
            {filteredProjects.map((proj) => (
              <div
                key={proj.id}
                onClick={() => loadProject(proj)}
                className={`project-card cursor-pointer ${selectedProject?.id === proj.id ? 'ring-2 ring-violet-500' : ''}`}
              >
                <div className="font-medium text-base mb-1 truncate">{proj.name}</div>
                <div className="repo-path mb-2">{proj.path}</div>

                <div className="flex flex-wrap gap-1 mb-1.5">
                  {proj.tags.slice(0, 4).map(renderTag)}
                </div>

                {proj.git_status && (
                  <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                    <GitBranch size={13} /> {proj.git_status.current_branch || 'detached'}
                    {proj.git_status.is_dirty && (
                      <span className="text-amber-400">• {proj.git_status.changed_files} cambios</span>
                    )}
                    {proj.git_status.ahead > 0 && <span className="text-emerald-400">↑{proj.git_status.ahead}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Main Content: Kanban or welcome */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedProject ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <div className="text-7xl mb-6 opacity-80">🥄</div>
              <h1 className="text-4xl font-semibold tracking-tighter mb-2">Bienvenido a Spoon</h1>
              <p className="max-w-md text-zinc-400 mb-8">
                Carga una carpeta con tus proyectos. Explora repos Git con una interfaz Kanban inspirada en Trello.
                Agrupa tus cambios y haz commits atómicos visualmente.
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
              {/* Project Header */}
              <div className="h-12 border-b border-[#2a2a2f] flex items-center px-4 gap-4 bg-[#111113] flex-shrink-0">
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
                  <button onClick={() => addCommitGroup()} className="px-3 py-1 rounded bg-white/5 hover:bg-white/10 text-xs flex items-center gap-1">
                    <GitCommit size={14} /> Nueva lista de commit
                  </button>
                </div>
              </div>

              {/* Kanban + Diff area */}
              <div className="flex flex-1 overflow-hidden bg-[#111113]">
                <div className={`flex-1 overflow-x-auto ${selectedFileForDiff ? 'border-r border-[#2a2a2f]' : ''}`}>
                  <DragDropContext onDragEnd={onDragEnd}>
                    <div className="kanban-board">
                      {commitGroups.map((group) => (
                      <Droppable key={group.id} droppableId={group.id}>
                        {(provided, snapshot) => (
                          <div
                            className={`kanban-list ${snapshot.isDraggingOver ? 'ring-1 ring-violet-500' : ''}`}
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                          >
                            <div className="kanban-list-header">
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                {group.id === UNSTAGED_ID && <Play size={14} />}
                                <input
                                  value={group.title}
                                  onChange={(e) => updateGroupTitle(group.id, e.target.value)}
                                  className="bg-transparent font-semibold text-sm w-full focus:outline-none text-white placeholder:text-zinc-500"
                                  placeholder={group.id === UNSTAGED_ID ? "Cambios sin stage" : "Título / primer línea del commit"}
                                  disabled={group.id === UNSTAGED_ID || group.id === STAGED_ID}
                                />
                              </div>

                              <div className="flex items-center gap-1">
                                <span className="text-[10px] px-1.5 py-px rounded bg-black/30">{group.cards.length}</span>

                                {group.id !== UNSTAGED_ID && group.id !== STAGED_ID && (
                                  <button onClick={() => removeGroup(group.id)} className="opacity-60 hover:opacity-100 p-0.5">
                                    <X size={13} />
                                  </button>
                                )}

                                {/* Main commit action is in the textarea composer below.
                                    Only show quick unstage for the staged list in header. */}
                                {group.id === STAGED_ID && group.cards.length > 0 && (
                                  <button onClick={() => unstageGroup(group.id)} className="ml-1 text-[10px] bg-orange-900/70 hover:bg-orange-800 px-2 py-px rounded">
                                    UNSTAGE
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="kanban-list-content" ref={provided.innerRef}>
                              {group.cards.map((card, index) => (
                                <Draggable key={card.id} draggableId={card.id} index={index}>
                                  {(prov, snap) => (
                                    <div
                                      ref={prov.innerRef}
                                      {...prov.draggableProps}
                                      {...prov.dragHandleProps}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        selectFileForDiff(card.file);
                                      }}
                                      className={`kanban-card ${snap.isDragging ? 'shadow-2xl ring-1 ring-violet-400' : ''} ${selectedFileForDiff?.path === card.file.path ? 'ring-2 ring-violet-400 !border-violet-500' : ''}`}
                                      title="Click para ver diff"
                                    >
                                      <div className="font-mono text-[11px] text-emerald-400 truncate">{card.file.path}</div>
                                      <div className="text-[10px] text-zinc-400 flex justify-between mt-0.5">
                                        <span>{card.file.status}</span>
                                        {card.file.staged && <span className="text-sky-400">staged</span>}
                                      </div>
                                    </div>
                                  )}
                                </Draggable>
                              ))}
                              {provided.placeholder}
                            </div>

                            {/* Commit message composer - place to write the commit */}
                            {(group.cards.length > 0 || group.id !== UNSTAGED_ID) && (
                              <div className="p-2 border-t border-[#2a2a2f] bg-[#1a1a1d]">
                                <div className="text-[9px] text-zinc-400 mb-0.5 px-0.5">Mensaje de commit</div>
                                <textarea
                                  value={group.title}
                                  onChange={(e) => updateGroupTitle(group.id, e.target.value)}
                                  placeholder="Escribe aquí el mensaje del commit..."
                                  className="w-full bg-[#111113] border border-[#2a2a2f] focus:border-violet-500 rounded p-1.5 text-xs font-mono resize-y min-h-[46px] leading-snug"
                                />
                                {group.cards.length > 0 && group.id !== UNSTAGED_ID && (
                                  <button
                                    onClick={() => commitGroup(group)}
                                    className="mt-1 w-full text-xs py-1 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 rounded font-medium"
                                  >
                                    COMMIT {group.cards.length} archivos → “{group.title.slice(0, 28)}{group.title.length > 28 ? '…' : ''}”
                                  </button>
                                )}
                              </div>
                            )}

                            {group.id === UNSTAGED_ID && currentUnstaged > 0 && (
                              <div className="p-2 border-t border-[#2a2a2f]">
                                <button onClick={stageAllUnstaged} className="w-full text-xs py-1 bg-white/5 hover:bg-white/10 rounded">
                                  Stage todo
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </Droppable>
                    ))}

                    {/* Add list button as last column */}
                    <div
                      onClick={addCommitGroup}
                      className="kanban-list flex items-center justify-center text-sm cursor-pointer bg-[#1a1a1d] border border-dashed border-[#3a3a40] hover:border-violet-500/50 min-h-[120px] text-zinc-400"
                    >
                      + Añadir grupo de commit
                    </div>
                  </div>
                </DragDropContext>
              </div>

              {/* Diff viewer sidebar (appears when a file card is clicked) */}
              {selectedFileForDiff && (
                <DiffViewer
                  filePath={selectedFileForDiff.path}
                  staged={selectedFileForDiff.staged}
                  diff={currentDiff}
                  onStage={stageFromDiff}
                  onUnstage={unstageFromDiff}
                  onClose={closeDiff}
                  isLoading={diffLoading}
                />
              )}
            </div>

            {/* Bottom panels: Branches + Visual Commit Graph (Fork-style thread) */}
            <div className="h-52 border-t border-[#2a2a2f] bg-[#0f0f11] flex overflow-hidden flex-shrink-0 text-sm">
              {/* Branches (quick switch) */}
              <div className="w-72 border-r border-[#2a2a2f] p-3 overflow-auto flex-shrink-0">
                <div className="uppercase tracking-[1px] text-[10px] font-semibold text-zinc-400 mb-2 flex items-center gap-2">
                  <GitBranch size={13} /> BRANCHES
                </div>
                <div className="flex flex-wrap gap-1">
                  {branches.slice(0, 18).map((b) => (
                    <button
                      key={b.name}
                      onClick={async () => {
                        if (!selectedProject || b.is_current) return;
                        await invoke('checkout_branch', { repoPath: selectedProject.path, branch: b.name });
                        await loadProject(selectedProject);
                      }}
                      className={`px-2 py-0.5 rounded text-xs border ${b.is_current ? 'bg-emerald-900/70 border-emerald-600' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}
                      title={b.is_remote ? 'remote' : 'local'}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
                <div className="text-[9px] text-zinc-500 mt-2">Click para checkout</div>
              </div>

              {/* Visual Commit History - Fork style thread/graph */}
              <div className="flex-1 overflow-hidden">
                <div className="px-2 pt-1 pb-0.5 uppercase tracking-[1px] text-[10px] font-semibold text-zinc-400 flex items-center gap-2">
                  <GitCommit size={13} /> HISTORY (visual graph)
                </div>
                <div className="h-[calc(100%-18px)]">
                  <CommitGraph
                    commits={commits}
                    branches={branches}
                    currentBranch={branches.find((b) => b.is_current)?.name || null}
                    onCheckout={async (commit) => {
                      if (!selectedProject) return;
                      // Checkout the specific commit (detached HEAD)
                      try {
                        await invoke('checkout_branch', { repoPath: selectedProject.path, branch: commit.hash });
                        await loadProject(selectedProject);
                        setStatusMsg(`Checked out ${commit.short_hash}`);
                        setTimeout(() => setStatusMsg(''), 2000);
                      } catch (e: any) {
                        setStatusMsg('Error checkout: ' + e);
                      }
                    }}
                  />
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

