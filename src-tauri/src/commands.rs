use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TechTag {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitStatus {
    pub current_branch: Option<String>,
    pub is_dirty: bool,
    pub ahead: usize,
    pub behind: usize,
    pub changed_files: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Project {
    pub id: String,
    pub name: String,
    pub path: String,
    pub tags: Vec<TechTag>,
    pub has_git: bool,
    pub git_status: Option<GitStatus>,
    pub last_commit: Option<String>,
    pub last_commit_date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitBranch {
    pub name: String,
    pub is_current: bool,
    pub is_remote: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GitCommit {
    pub hash: String,
    pub short_hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub date: String,
    pub message: String,
    pub refs: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileChange {
    pub path: String,
    pub status: String, // "modified", "added", "deleted", "renamed", "untracked"
    pub staged: bool,
}

#[tauri::command]
pub fn scan_directory(root_path: String) -> Result<Vec<Project>, String> {
    let root = Path::new(&root_path);
    if !root.exists() || !root.is_dir() {
        return Err("El directorio no existe o no es válido".to_string());
    }

    let mut projects: Vec<Project> = Vec::new();

    // Walk max depth 5 levels to avoid huge scans (tunable)
    for entry in WalkDir::new(root)
        .max_depth(5)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();

        // Skip common heavy dirs
        if path.to_string_lossy().contains("/node_modules/")
            || path.to_string_lossy().contains("\\node_modules\\")
            || path.to_string_lossy().contains("/.git/")
            || path.to_string_lossy().contains("\\.git\\")
            || path.to_string_lossy().contains("/target/")
            || path.to_string_lossy().contains("\\target\\")
            || path.to_string_lossy().contains("/dist/")
            || path.to_string_lossy().contains("\\dist\\")
        {
            continue;
        }

        if is_git_repo(path) {
            let tags = detect_tech_tags(path);
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_string();

            let git_status = get_git_status(path).ok();
            let last_commit = get_last_commit_info(path).ok();

            let project = Project {
                id: path.to_string_lossy().to_string(),
                name,
                path: path.to_string_lossy().to_string(),
                tags,
                has_git: true,
                git_status,
                last_commit: last_commit.as_ref().map(|c| c.message.clone()),
                last_commit_date: last_commit.as_ref().map(|c| c.date.clone()),
            };
            projects.push(project);
        }
    }

    // Sort by name
    projects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(projects)
}

fn is_git_repo(path: &Path) -> bool {
    path.join(".git").exists() && path.join(".git").is_dir()
}

fn detect_tech_tags(path: &Path) -> Vec<TechTag> {
    let mut tags = Vec::new();

    // Unity
    if path.join("Assets").is_dir()
        && (path.join("ProjectSettings").is_dir() || path.join("Packages").is_dir())
    {
        tags.push(TechTag {
            name: "Unity".to_string(),
            color: "#3b2a6e".to_string(),
        });
    }

    // .NET / C#
    let has_csproj = WalkDir::new(path)
        .max_depth(2)
        .into_iter()
        .any(|e| {
            if let Ok(entry) = e {
                entry.file_name().to_string_lossy().ends_with(".csproj")
                    || entry.file_name().to_string_lossy().ends_with(".sln")
            } else {
                false
            }
        });

    if has_csproj || path.join("global.json").exists() {
        tags.push(TechTag {
            name: ".NET".to_string(),
            color: "#512bd4".to_string(),
        });
        tags.push(TechTag {
            name: "C#".to_string(),
            color: "#68217a".to_string(),
        });
    }

    // Python
    if path.join("pyproject.toml").exists()
        || path.join("requirements.txt").exists()
        || path.join("setup.py").exists()
        || path.join("Pipfile").exists()
        || path.join("poetry.lock").exists()
    {
        tags.push(TechTag {
            name: "Python".to_string(),
            color: "#306998".to_string(),
        });
    }

    // Rust
    if path.join("Cargo.toml").exists() {
        tags.push(TechTag {
            name: "Rust".to_string(),
            color: "#dea584".to_string(),
        });
    }

    // Go
    if path.join("go.mod").exists() {
        tags.push(TechTag {
            name: "Go".to_string(),
            color: "#00add8".to_string(),
        });
    }

    // Node / JS / TS
    if path.join("package.json").exists() {
        let is_ts = path.join("tsconfig.json").exists()
            || WalkDir::new(path)
                .max_depth(1)
                .into_iter()
                .any(|e| {
                    e.as_ref()
                        .map(|ent| ent.file_name().to_string_lossy().ends_with(".ts") || ent.file_name().to_string_lossy().ends_with(".tsx"))
                        .unwrap_or(false)
                });

        if is_ts {
            tags.push(TechTag {
                name: "TypeScript".to_string(),
                color: "#3178c6".to_string(),
            });
        } else {
            tags.push(TechTag {
                name: "JavaScript".to_string(),
                color: "#f0db4f".to_string(),
            });
        }

        // Try to detect popular frameworks from package.json (simple string scan)
        if let Ok(content) = std::fs::read_to_string(path.join("package.json")) {
            let lower = content.to_lowercase();
            if lower.contains("next") {
                tags.push(TechTag { name: "Next.js".to_string(), color: "#000000".to_string() });
            } else if lower.contains("react") {
                tags.push(TechTag { name: "React".to_string(), color: "#61dafb".to_string() });
            } else if lower.contains("vue") {
                tags.push(TechTag { name: "Vue".to_string(), color: "#42b883".to_string() });
            } else if lower.contains("svelte") {
                tags.push(TechTag { name: "Svelte".to_string(), color: "#ff3e00".to_string() });
            } else if lower.contains("nestjs") || lower.contains("@nestjs") {
                tags.push(TechTag { name: "NestJS".to_string(), color: "#e0234e".to_string() });
            }
        }
    }

    // Java / Gradle / Maven
    if path.join("pom.xml").exists() || path.join("build.gradle").exists() || path.join("build.gradle.kts").exists() {
        tags.push(TechTag {
            name: "Java".to_string(),
            color: "#f89820".to_string(),
        });
    }

    // Flutter / Dart
    if path.join("pubspec.yaml").exists() {
        tags.push(TechTag {
            name: "Flutter".to_string(),
            color: "#02569b".to_string(),
        });
    }

    // If no specific tags but has .git, add generic
    if tags.is_empty() {
        tags.push(TechTag {
            name: "Git".to_string(),
            color: "#f05032".to_string(),
        });
    }

    tags
}

fn get_git_status(repo: &Path) -> Result<GitStatus, String> {
    // Use git command for status (reliable, no extra build complexity)
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["status", "--porcelain", "--branch"])
        .output()
        .map_err(|e| format!("git status failed: {}", e))?;

    if !output.status.success() {
        return Err("git status error".to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut is_dirty = false;
    let mut changed_files = 0;
    let mut current_branch = None;
    let mut ahead = 0;
    let mut behind = 0;

    for line in stdout.lines() {
        if line.starts_with("##") {
            // parse branch line: ## main...origin/main [ahead 1, behind 2]
            if let Some(branch_part) = line.strip_prefix("## ") {
                if let Some(branch) = branch_part.split("...").next() {
                    current_branch = Some(branch.trim().to_string());
                }
                if branch_part.contains("ahead") {
                    // naive parse
                    if let Some(a) = branch_part.split("ahead ").nth(1) {
                        if let Some(num) = a.split(|c: char| !c.is_numeric()).next() {
                            ahead = num.parse().unwrap_or(0);
                        }
                    }
                }
                if branch_part.contains("behind") {
                    if let Some(b) = branch_part.split("behind ").nth(1) {
                        if let Some(num) = b.split(|c: char| !c.is_numeric()).next() {
                            behind = num.parse().unwrap_or(0);
                        }
                    }
                }
            }
            continue;
        }
        if !line.trim().is_empty() {
            is_dirty = true;
            changed_files += 1;
        }
    }

    Ok(GitStatus {
        current_branch,
        is_dirty,
        ahead,
        behind,
        changed_files,
    })
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LastCommit {
    pub message: String,
    pub date: String,
}

fn get_last_commit_info(repo: &Path) -> Result<LastCommit, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["log", "-1", "--pretty=format:%s|%ci"])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err("no commits".into());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = stdout.trim().split('|').collect();
    if parts.len() >= 2 {
        Ok(LastCommit {
            message: parts[0].to_string(),
            date: parts[1].to_string(),
        })
    } else {
        Err("parse error".into())
    }
}

#[tauri::command]
pub fn get_branches(repo_path: String) -> Result<Vec<GitBranch>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args(["branch", "-a", "--format=%(refname:short)|%(HEAD)"])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut branches = vec![];

    for line in stdout.lines() {
        if line.trim().is_empty() { continue; }
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() >= 2 {
            let name = parts[0].trim().to_string();
            let is_current = parts[1].contains('*');
            let is_remote = name.starts_with("origin/") || name.starts_with("remotes/");
            branches.push(GitBranch {
                name: name.replace("origin/", "").replace("remotes/", ""),
                is_current,
                is_remote,
            });
        }
    }

    // Dedup a bit
    branches.sort_by(|a, b| a.name.cmp(&b.name));
    branches.dedup_by(|a, b| a.name == b.name);

    Ok(branches)
}

#[tauri::command]
pub fn get_commit_log(repo_path: String, limit: Option<usize>) -> Result<Vec<GitCommit>, String> {
    let lim = limit.unwrap_or(50);
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args([
            "log",
            &format!("-{}", lim),
            "--pretty=format:%H|%h|%P|%an|%ae|%ci|%s|%D",
            "--date=iso",
        ])
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Ok(vec![]);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut commits = vec![];

    for line in stdout.lines() {
        let parts: Vec<&str> = line.splitn(8, '|').collect();
        if parts.len() >= 7 {
            let parents: Vec<String> = if parts.len() > 2 && !parts[2].trim().is_empty() {
                parts[2]
                    .split(' ')
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.to_string())
                    .collect()
            } else {
                vec![]
            };

            let refs = if parts.len() > 7 {
                parts[7]
                    .split(", ")
                    .filter(|s| !s.trim().is_empty())
                    .map(|s| s.to_string())
                    .collect()
            } else {
                vec![]
            };

            commits.push(GitCommit {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                parents,
                author: parts[3].to_string(),
                email: parts[4].to_string(),
                date: parts[5].to_string(),
                message: parts[6].to_string(),
                refs,
            });
        }
    }

    Ok(commits)
}

#[tauri::command]
pub fn get_file_changes(repo_path: String) -> Result<Vec<FileChange>, String> {
    // Unstaged + staged
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args(["status", "--porcelain"])
        .output()
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut changes = vec![];

    for line in stdout.lines() {
        if line.len() < 3 { continue; }
        let status_code = &line[0..2];
        let path = line[3..].to_string();

        let (staged, work_status) = match (status_code.as_bytes()[0] as char, status_code.as_bytes()[1] as char) {
            (' ', 'M') => (false, "modified"),
            ('M', ' ') => (true, "modified"),
            ('M', 'M') => (true, "modified"),
            ('A', ' ') => (true, "added"),
            (' ', 'A') => (false, "added"),
            ('D', ' ') => (true, "deleted"),
            (' ', 'D') => (false, "deleted"),
            ('R', _) => (true, "renamed"),
            ('?', '?') => (false, "untracked"),
            _ => (false, "modified"),
        };

        changes.push(FileChange {
            path,
            status: work_status.to_string(),
            staged,
        });
    }

    Ok(changes)
}

// select_directory is intentionally not exposed; frontend uses the dialog plugin directly.

#[tauri::command]
pub fn stage_files(repo_path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(&repo_path).arg("add").arg("--").args(&files);
    let status = cmd.status().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("git add failed".to_string())
    }
}

#[tauri::command]
pub fn unstage_files(repo_path: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let mut cmd = Command::new("git");
    cmd.arg("-C").arg(&repo_path).arg("reset").arg("--").args(&files);
    let status = cmd.status().map_err(|e| e.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("git reset failed".to_string())
    }
}

#[tauri::command]
pub fn commit_changes(repo_path: String, message: String, files: Option<Vec<String>>) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("El mensaje de commit no puede estar vacío".to_string());
    }

    // If specific files provided, ensure they are staged (idempotent)
    if let Some(fs) = &files {
        if !fs.is_empty() {
            let _ = stage_files(repo_path.clone(), fs.clone());
        }
    }

    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args(["commit", "-m", &message])
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(stdout.trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("Commit falló: {}", stderr.trim()))
    }
}

#[tauri::command]
pub fn checkout_branch(repo_path: String, branch: String) -> Result<(), String> {
    let status = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args(["checkout", &branch])
        .status()
        .map_err(|e| e.to_string())?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("No se pudo cambiar a la rama {}", branch))
    }
}

#[tauri::command]
pub fn fetch(repo_path: String) -> Result<(), String> {
    Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .arg("fetch")
        .status()
        .map_err(|e| e.to_string())
        .map(|_| ())
}

#[tauri::command]
pub fn get_diff(repo_path: String, file_path: String, staged: bool) -> Result<String, String> {
    let mut args = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(&file_path);

    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
