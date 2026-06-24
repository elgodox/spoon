# 🥄 Spoon

**Spoon** es una aplicación de escritorio web (desktop app) que combina lo mejor de [Git Fork](https://git-fork.com/) y [Trello](https://trello.com/es) para gestionar tus proyectos locales con Git de forma visual, rápida y productiva.

Carga un directorio de tu PC, descubre automáticamente todos tus proyectos Git, los etiqueta por tecnología (Unity, C#, .NET, Python, Node, Rust, Go, etc.), y gestiona branches, commits, staging y commits **usando una interfaz Kanban tipo Trello**.

> "El poder de un cliente Git avanzado con la ergonomía visual de un board de tareas."

## ✨ Características Principales

### 🔍 Descubrimiento y Etiquetado Inteligente
- Selecciona cualquier carpeta raíz de tu PC (o varios "workspaces").
- Escanea recursivamente buscando repositorios Git.
- Detecta automáticamente el stack tecnológico de cada proyecto:
  - **Unity** (Assets/, ProjectSettings/, *.unity, Packages/manifest.json)
  - **C# / .NET** (*.csproj, *.sln, global.json, Directory.Build.props)
  - **Python** (pyproject.toml, requirements.txt, setup.py, poetry.lock, Pipfile)
  - **JavaScript / TypeScript / Node** (package.json + frameworks: React, Next, Nest, Vue, Svelte, etc.)
  - **Rust** (Cargo.toml)
  - **Go** (go.mod)
  - **Java / Kotlin** (pom.xml, build.gradle, *.kt)
  - **PHP, Ruby, Dart/Flutter**, y más (fácil de extender).
- Tags visuales + colores por tecnología.
- Filtros, búsqueda y agrupación por tags, estado (limpio / dirty), branch actual.

### 📋 Interfaz Kanban Tipo Trello para Git
Dentro de cada proyecto (o vista multi-proyecto):

- **Tablero Kanban por repositorio**:
  - **Lista: Working Tree** → archivos modificados (unstaged). Tarjetas = archivos o hunks.
  - **Listas de "Commit Groups"** (creas las que quieras): arrastra archivos/hunks a distintos grupos para preparar commits atómicos.
  - **Lista: Staged** (o por grupo).
  - **Lista: Recent Commits** → los últimos commits como tarjetas (click para ver diff completo, checkout, etc.).
  - **Lista: Branches** → tarjetas de branches locales/remotas. Drag para checkout, merge desde UI, etc.

- **Drag & Drop poderoso**:
  - Arrastra un archivo desde Working Tree a un "Commit Bucket".
  - Soporte para selección múltiple + drag.
  - Split de cambios por líneas (inspirado en Fork) cuando sea posible.
  - Mueve entre grupos para reorganizar el trabajo antes de commitear.

- **Commit desde el Kanban**:
  - Cada "Commit Group" (lista) tiene su propio mensaje de commit (editable como título de lista en Trello).
  - Botón "Commit Group" → hace commit solo con los archivos/hunks de esa lista.
  - Opción "Commit & Push", amend, etc.

### 🌿 Git Completo (estilo Git Fork)
- Ver y cambiar de branch (checkout).
- Ver historial de commits con grafo simple (o lista detallada).
- Fetch / Pull / Push con un clic.
- Stage / Unstage granular (archivo completo o por líneas).
- Crear / borrar / renombrar branches.
- Stashes.
- Merge / Rebase básico (con UI para resolver conflictos simples al principio).
- Ver diffs bonitos (side-by-side o unified).
- Submódulos (básico).
- Soporte multi-remote.

### 🗂️ Gestión de Workspaces
- "Open Folder" → elige directorio raíz (usa diálogo nativo).
- Soporte para múltiples workspaces abiertos simultáneamente.
- Persistencia de workspaces recientes (local storage / config file).
- Vista "All Projects Board": un tablero global con columnas tipo "Unity Projects", "Backend .NET", "Python Tools", "Misc", donde las tarjetas son proyectos enteros. Arrastra proyectos entre columnas para categorizar (persiste tags/custom labels).

### 🖥️ Otras Features
- Modo oscuro / claro (automático o manual).
- Atajos de teclado (inspirados en Trello + VSCode + Fork).
- Búsqueda global de commits / archivos / mensajes.
- Estadísticas rápidas por proyecto (commits ahead/behind, files changed, etc.).
- Exportar lista de cambios o "commit plan" a markdown.
- (Futuro) Integración ligera con GitHub/GitLab (PRs, issues como tarjetas extra).

## 🖼️ UI Inspiración

- **Tableros** como Trello: columnas (lists) + tarjetas arrastrables.
- **Dentro de un repo**: flujo de trabajo visual para preparar commits atómicos (muy superior a `git add -p`).
- **Estética limpia y densa** como Git Fork: información relevante sin ruido, diffs claros, grafo de commits.
- Responsive dentro de la ventana desktop (sidebar de proyectos + board principal).

## 🛠️ Stack Tecnológico

**Desktop App (Web + Native)**
- **Tauri v2** (Rust backend + web frontend) — binario pequeño, seguro, sin Electron bloat.
- **Frontend**:
  - React 19 + TypeScript
  - Vite
  - Drag & Drop: `@hello-pangea/dnd` (o dnd-kit / @dnd-kit) para kanban fluido.
  - Estilos: Tailwind CSS + componentes custom o shadcn/ui (planeado).
  - Diff viewer: simple custom o react-diff-view.
- **Backend (Rust commands expuestos vía Tauri IPC)**:
  - `git2` crate (libgit2) para operaciones Git rápidas y completas.
  - `walkdir` + `std::fs` para escaneo rápido de proyectos.
  - Detección de tech via heurística de archivos + parsers simples (toml, json, etc.).
  - `tauri-plugin-dialog`, `tauri-plugin-fs`.

**Alternativa futura**: si se quiere web pura (sin desktop), usar File System Access API + isomorphic-git, pero con limitaciones (no recomendado para uso real).

## 📁 Estructura del Proyecto

```
spoon/
├── src/                    # Frontend React
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── ProjectCard.tsx
│   │   ├── KanbanBoard.tsx
│   │   ├── CommitCard.tsx
│   │   ├── DiffViewer.tsx
│   │   └── ...
│   ├── hooks/
│   ├── stores/             # Zustand o Context para estado global (projects, selected repo)
│   └── utils/
├── src-tauri/              # Backend Rust + Tauri config
│   ├── src/
│   │   ├── lib.rs          # Registro de comandos + plugins
│   │   └── main.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/
├── package.json
├── vite.config.ts
└── README.md
```

Comandos Tauri se definen con `#[tauri::command]` y se exponen en `invoke_handler!`.

## 🚀 Cómo Empezar (Desarrollo)

**Requisitos**
- Node.js >= 20 + npm
- **Rust (stable) + Cargo** — Instálalo con `winget install Rustlang.Rustup` (Windows) o https://rustup.rs
- Git instalado y en PATH (ya lo tienes normalmente)
- En Windows: WebView2 (preinstalado en la mayoría de sistemas modernos)

**Pasos**

```bash
# 1. Clona / entra al directorio
cd spoon

# 2. Instala deps frontend
npm install

# 3. (Opcional primera vez) Compila deps Rust pesadas (git2 vendored)
#    Tarda un poco la primera vez

# 4. Corre en modo dev (abre ventana nativa)
npm run tauri dev
```

O construye:

```bash
npm run tauri build   # genera instalador/exe en src-tauri/target/release/bundle
```

En primera ejecución de `tauri dev` compilará el backend Rust (walkdir + tauri plugins). El binario final es muy ligero (~10-20MB).

## ▶️ Estado Actual de Implementación (Junio 2026)

**Funciona hoy:**
- ✅ Selector nativo de directorios
- ✅ Escaneo recursivo inteligente (ignora node_modules, target, dist, .git)
- ✅ Detección de tags: Unity, .NET/C#, Python, Rust, Go, JS/TS + frameworks (React, Next, Vue, Svelte, NestJS, Flutter, Java, etc.)
- ✅ Vista de proyectos con tarjetas bonitas + tags de colores + info de branch + dirty status
- ✅ Kanban Trello-style completo con **@hello-pangea/dnd**
  - Listas: "Cambios sin stage", "Mi commit #1", "Listos para commit"
  - Crea tantas listas/grupos dinámicos como quieras
  - Arrastra tarjetas (archivos) entre listas
  - Edita título de lista → se usa como mensaje de commit
  - Botón COMMIT por grupo (hace git add selectivo + commit)
- ✅ Carga de branches (checkout al click), log reciente y cambios
- ✅ Stage automático + commit + refresh completo
- ✅ Full Rust backend vía `git` CLI + walkdir (rápido y confiable)
- ✅ UI oscura moderna tipo Trello/Fork

**Próximo inmediato:**
- Persistencia de workspaces recientes
- Ver diff al click en tarjeta
- Soporte para unstage
- Mejor manejo de errores y loading states
- Soporte multi-workspace + board global estilo Trello para proyectos

## 🧩 Comandos Backend (IPC) Implementados

- `scan_directory(path: string)` → Project[]
- `get_project_status(repo_path: string)` → { branches, current_branch, changes, ... }
- `get_commit_log(repo_path, limit)` → Commit[]
- `get_branches(repo_path)` → GitBranch[]
- `get_commit_log(repo_path, limit?)` → GitCommit[]
- `get_file_changes(repo_path)` → FileChange[]
- `stage_files(repo_path, files)`
- `unstage_files(repo_path, files)`
- `commit_changes(repo_path, message, files?)`
- `checkout_branch(repo_path, branch)`
- `fetch(repo_path)`
- `get_diff(...)`

El estado de "grupos de commit" (listas kanban) vive principalmente en el frontend (React + dnd). Solo se sincroniza con Git al pulsar "COMMIT" en un grupo.

## 🗺️ Roadmap / Fases de Implementación

**✅ Completado (MVP muy usable)**
- Escaneo + tags + proyecto cards
- Kanban drag & drop con grupos de commit arbitrarios + commit por grupo
- Integración completa de status, branches, log, stage, commit
- Checkout de rama
- UI lista para uso diario en Windows

**Próximos pasos recomendados**
1. Persistencia (localStorage o archivo de config) de workspaces recientes + último proyecto abierto.
2. Ver diff de un archivo (usa comando get_diff + bonito viewer).
3. Unstage desde UI + drag de vuelta.
4. Soporte "commit amend" y "commit vacío".
5. Filtros en sidebar de proyectos (por tag, dirty, nombre).
6. Board global estilo Trello: columnas por tecnología o custom "En progreso" / "Listo para review".
7. Atajos de teclado (space para commit rápido, etc.).
8. Soporte de más git ops (pull/push con feedback).

**Futuro**
- Grafo de commits visual.
- Conflict resolver básico.
- Integración ligera GitHub (ver PRs asociados).
- Temas + configuraciones.
- Builds firmados + auto-update (Tauri updater).

¡El core que pediste (Fork power + Trello UX) ya está funcionando!

### Prueba rápida

```powershell
# En este directorio (H:\git\spoon)
npm run tauri dev
```

1. Pulsa "Abrir Directorio"
2. Elige `H:\git` o tu carpeta de proyectos
3. Verás proyectos con tags (TypeScript, etc.)
4. Haz click en uno → se carga el kanban con tus cambios
5. Arrastra archivos entre listas
6. Edita el título de una lista → pulsa COMMIT en ella

¡Listo! Tus commits agrupados visualmente sin tocar terminal.

## 🤝 Contribuir

Este es un proyecto personal / de aprendizaje por ahora. Issues y PRs bienvenidos una vez abierto.

Ideas de nombre alternativas que se consideraron: ForkBoard, GitTrello, KanGit, SpoonGit, RepoBoard.

## 📄 Licencia

MIT (por ahora).

---

**Spoon** — Porque a veces necesitas "alimentar" tus commits de forma ordenada y visual, como con una cuchara (spoon).

¡Carga tu carpeta de proyectos y empieza a mover tarjetas en vez de escribir comandos!
