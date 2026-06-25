import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DetectedCli } from '../types';
import 'xterm/css/xterm.css';

interface AITerminalProps {
  repoPath?: string | null;
  cliCommands?: DetectedCli[];
  autoStart?: boolean;
}

const preferredCliOrder = [
  'codex',
  'claude',
  'grok',
  'gemini',
  'aider',
  'opencode',
  'qwen',
  'python',
  'node',
];

export function AITerminal({ repoPath, cliCommands = [], autoStart = false }: AITerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#0a0a0b',
        foreground: '#e5e5e5',
        cursor: '#a78bfa',
      },
      scrollback: 2000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitRef.current = fitAddon;

    // Send initial size to PTY (critical for line editing / input in pwsh)
    const sendResize = () => {
      if (termRef.current) {
        const { rows, cols } = termRef.current;
        invoke('resize_terminal', { rows, cols }).catch((err) =>
          console.error('resize_terminal failed', err)
        );
      }
    };

    sendResize();

    // Listen to xterm's own resize events (e.g. when fit changes the size)
    const resizeListener = term.onResize(() => {
      sendResize();
    });

    // Listen to backend PTY output
    const unlistenPromise = listen<string>('terminal-output', (event) => {
      term.write(event.payload);
    });

    // Send user keystrokes to the PTY
    const dataListener = term.onData((data) => {
      invoke('write_to_terminal', { data }).catch((err) =>
        console.error('write_to_terminal failed', err)
      );
    });

    const handleWindowResize = () => {
      fitAddon.fit();
      sendResize();
    };
    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
      resizeListener.dispose();
      dataListener.dispose();
      unlistenPromise.then((f) => f());
      term.dispose();
    };
  }, []);

  const startShell = async (shouldFocus = false) => {
    if (!repoPath) {
      return;
    }
    // Always clear previous content when (re)starting for a new project
    if (termRef.current) {
      termRef.current.reset(); // full clean, prevents accumulation of old banners
    }
    try {
      await invoke('start_powershell', { repoPath });
      if (termRef.current) {
        termRef.current.writeln('\r\n[PowerShell iniciado en ' + repoPath + ']\r\n');
        termRef.current.writeln('Puedes ejecutar claude, codex, grok u otros agentes aquí. Escribe comandos normalmente.\r\n');
        // Force size sync + focus after the shell is alive (fixes input on many Windows setups)
        const { rows, cols } = termRef.current;
        invoke('resize_terminal', { rows, cols }).catch(() => {});
        if (shouldFocus) {
          termRef.current.focus();
        }
      }
    } catch (e: any) {
      console.error(e);
      if (termRef.current) {
        termRef.current.writeln('\r\n[Error al iniciar shell: ' + e + ']\r\n');
      }
    }
  };

  // Auto-start PowerShell when repo changes (and clear previous)
  useEffect(() => {
    if (!autoStart || !repoPath) return;
    const t = setTimeout(() => {
      startShell();
    }, 120);
    return () => clearTimeout(t);
  }, [autoStart, repoPath]);

  const injectAiPrompt = async () => {
    if (!repoPath) {
      alert('Selecciona un proyecto primero');
      return;
    }

    // Build a strong prompt that tells the AI in the shell to review context
    const prompt = `You are an expert software engineer and git assistant. 
The current working directory is a git repository.
Please run 'git status' and 'git diff --stat' (and 'git diff' if needed) to understand the changes.
Analyze what was modified, added or removed, the purpose based on the code, and context.
Then craft a clear, professional, concise commit message in English following Conventional Commits (type(scope): description).
Finally, commit the changes using that message and push to the remote (git push).
Confirm the result when done.

Start now.
`;

    try {
      await invoke('write_to_terminal', { data: prompt + '\r' });
      if (termRef.current) {
        termRef.current.writeln('\r\n[Prompt inyectado. El agente de IA en la terminal debería procesarlo.]\r\n');
      }
    } catch (e: any) {
      console.error(e);
    }
  };

  const visibleCliCommands = preferredCliOrder
    .map((name) => cliCommands.find((cli) => cli.name === name))
    .filter((cli): cli is DetectedCli => Boolean(cli))
    .slice(0, 6);

  const launchCli = async (command: string) => {
    if (!repoPath) {
      alert('Selecciona un proyecto primero');
      return;
    }

    await invoke('write_to_terminal', { data: `${command}\r` });
    termRef.current?.focus();
  };

  const launchCustomCli = async () => {
    const hint = cliCommands.slice(0, 40).map((cli) => cli.name).join(', ');
    const command = prompt(`CLI to run?\n${hint ? `Detected: ${hint}` : ''}`);
    if (!command?.trim()) return;
    await launchCli(command.trim());
  };

  return (
    <div className="flex flex-col h-full border border-[#2a2a2f] rounded overflow-hidden bg-[#0a0a0b]">
      <div className="flex items-center gap-1.5 px-2 py-1.5 bg-[#1a1a1d] border-b border-[#2a2a2f] flex-shrink-0 overflow-x-auto">
        <button
          onClick={() => startShell(true)}
          className="text-[10px] px-2 py-0.5 bg-emerald-700 hover:bg-emerald-600 rounded font-medium whitespace-nowrap"
        >
          Shell
        </button>
        <button
          onClick={injectAiPrompt}
          disabled={!repoPath}
          className="text-[10px] px-2 py-0.5 bg-violet-600 hover:bg-violet-500 rounded font-medium disabled:opacity-50 whitespace-nowrap"
        >
          Prompt
        </button>
        <button
          onClick={() => {
            if (termRef.current) {
              termRef.current.reset();
              termRef.current.writeln('Terminal limpiada.\r\n');
            }
          }}
          className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded whitespace-nowrap"
          title="Limpiar la terminal"
        >
          Clear
        </button>
        {visibleCliCommands.map((cli) => (
          <button
            key={cli.name}
            onClick={() => launchCli(cli.name)}
            className="text-[10px] px-2 py-0.5 bg-sky-900/70 hover:bg-sky-800 rounded whitespace-nowrap"
            title={cli.path}
          >
            {cli.name}
          </button>
        ))}
        <button
          onClick={launchCustomCli}
          className="text-[10px] px-2 py-0.5 bg-white/10 hover:bg-white/20 rounded whitespace-nowrap"
        >
          CLI...
        </button>
      </div>
      <div 
        ref={containerRef} 
        className="flex-1 p-1 overflow-hidden" 
        tabIndex={0}
        onClick={() => termRef.current?.focus()}
        onFocus={() => termRef.current?.focus()}
        style={{ cursor: 'text', outline: 'none' }}
      />
    </div>
  );
}

export default AITerminal;
