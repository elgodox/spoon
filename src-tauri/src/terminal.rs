use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::process::Command as StdCommand;
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use tauri::{AppHandle, Emitter, State};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
#[cfg(windows)]
use winreg::RegKey;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Default)]
pub struct TerminalState {
    pub master: Arc<Mutex<Option<Box<dyn MasterPty + Send>>>>,
    pub writer: Arc<Mutex<Option<Box<dyn Write + Send>>>>,
    pub child_killer: Arc<Mutex<Option<Box<dyn portable_pty::ChildKiller + Send>>>>,
    pub current_cwd: Arc<Mutex<Option<String>>>,
}

/// Resolve the best PowerShell executable, preferring the latest PowerShell 7+ (pwsh).
/// If not found, attempts to install it via winget (Windows only).
fn resolve_powershell() -> Result<String, String> {
    static POWERSHELL_EXE: OnceLock<String> = OnceLock::new();
    if let Some(cached) = POWERSHELL_EXE.get() {
        return Ok(cached.clone());
    }

    // 1. Check if "pwsh" (PowerShell 7+) is already in PATH
    if let Ok(output) = system_command("pwsh").arg("--version").output() {
        if output.status.success() {
            let resolved = "pwsh".to_string();
            let _ = POWERSHELL_EXE.set(resolved.clone());
            return Ok(resolved);
        }
    }

    // 2. Check common installation locations for PowerShell 7+
    let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let candidates: Vec<String> = vec![
        r"C:\Program Files\PowerShell\7\pwsh.exe".to_string(),
        r"C:\Program Files\PowerShell\7-preview\pwsh.exe".to_string(),
        format!(r"{}\PowerShell\7\pwsh.exe", local_app_data),
        format!(r"{}\Programs\PowerShell\7\pwsh.exe", local_app_data),
    ];

    for p in &candidates {
        if Path::new(p).exists() {
            let resolved = p.clone();
            let _ = POWERSHELL_EXE.set(resolved.clone());
            return Ok(resolved);
        }
    }

    // 3. Not found — try to install the latest via winget
    // This requires winget (available on modern Windows 10/11)
    if let Ok(status) = system_command("winget")
        .args([
            "install",
            "--id",
            "Microsoft.PowerShell",
            "--source",
            "winget",
            "-e",
            "--silent",
            "--accept-package-agreements",
            "--accept-source-agreements",
        ])
        .status()
    {
        if status.success() {
            // Re-scan after install
            for p in &candidates {
                if Path::new(p).exists() {
                    let resolved = p.clone();
                    let _ = POWERSHELL_EXE.set(resolved.clone());
                    return Ok(resolved);
                }
            }
            // PATH might not be updated until restart, fallback to name
            let resolved = "pwsh".to_string();
            let _ = POWERSHELL_EXE.set(resolved.clone());
            return Ok(resolved);
        }
    }

    Err("PowerShell 7 (pwsh) was not found and could not be auto-installed.\nPlease install it manually: https://github.com/PowerShell/PowerShell/releases".to_string())
}

#[cfg(windows)]
fn system_command(program: &str) -> StdCommand {
    let mut command = StdCommand::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn system_command(program: &str) -> StdCommand {
    StdCommand::new(program)
}

#[cfg(windows)]
fn read_registry_env(root: RegKey, subkey: &str) -> HashMap<String, String> {
    let mut values = HashMap::new();
    let Ok(key) = root.open_subkey(subkey) else {
        return values;
    };

    for item in key.enum_values().flatten() {
        let name = item.0;
        if let Ok(value) = key.get_value::<String, _>(&name) {
            values.insert(name, value);
        }
    }

    values
}

#[cfg(windows)]
fn dedupe_path(parts: Vec<String>) -> String {
    let mut seen = Vec::<String>::new();
    let mut ordered = Vec::<String>::new();

    for part in parts {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }

        let lowered = trimmed.to_ascii_lowercase();
        if seen.iter().any(|value| value == &lowered) {
            continue;
        }

        seen.push(lowered);
        ordered.push(trimmed.to_string());
    }

    ordered.join(";")
}

#[cfg(windows)]
fn build_shell_env_inner() -> HashMap<String, String> {
    let mut env_map: HashMap<String, String> = std::env::vars().collect();
    let machine_env = read_registry_env(
        RegKey::predef(HKEY_LOCAL_MACHINE),
        r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment",
    );
    let user_env = read_registry_env(RegKey::predef(HKEY_CURRENT_USER), "Environment");

    for (key, value) in machine_env.iter() {
        env_map.insert(key.clone(), value.clone());
    }

    for (key, value) in user_env.iter() {
        env_map.insert(key.clone(), value.clone());
    }

    let merged_path = dedupe_path(
        [
            env_map.get("PATH").cloned(),
            machine_env.get("Path").cloned(),
            machine_env.get("PATH").cloned(),
            user_env.get("Path").cloned(),
            user_env.get("PATH").cloned(),
            std::env::var("PATH").ok(),
        ]
        .into_iter()
        .flatten()
        .flat_map(|value| value.split(';').map(|part| part.to_string()).collect::<Vec<_>>())
        .collect(),
    );

    env_map.insert("PATH".to_string(), merged_path.clone());
    env_map.insert("Path".to_string(), merged_path);
    env_map
}

#[cfg(not(windows))]
fn build_shell_env_inner() -> HashMap<String, String> {
    std::env::vars().collect()
}

fn build_shell_env() -> HashMap<String, String> {
    static SHELL_ENV: OnceLock<HashMap<String, String>> = OnceLock::new();
    SHELL_ENV.get_or_init(build_shell_env_inner).clone()
}

#[tauri::command]
pub fn start_powershell(
    app: AppHandle,
    state: State<'_, TerminalState>,
    repo_path: String,
) -> Result<(), String> {
    // Kill previous shell if running
    {
        let mut killer = state.child_killer.lock().unwrap();
        if let Some(mut k) = killer.take() {
            let _ = k.kill();
        }
    }
    {
        let mut w = state.writer.lock().unwrap();
        *w = None;
    }
    {
        let mut m = state.master.lock().unwrap();
        *m = None;
    }

    let pwsh_exe = resolve_powershell()?;

    let pty_system = native_pty_system();

    let pair = pty_system
        .openpty(PtySize {
            rows: 32,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("openpty failed: {}", e))?;

    let mut cmd = CommandBuilder::new(pwsh_exe);
    cmd.arg("-NoLogo");
    cmd.arg("-NoExit");
    cmd.cwd(&repo_path);
    // ponytail: refresh persisted user/system env so CLIs see newly saved tokens without restarting Spoon.
    for (key, value) in build_shell_env() {
        cmd.env(key, value);
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("spawn pwsh failed: {}", e))?;

    // Keep the master so we can resize it later and clone reader
    let master = pair.master;

    // Take the writer for sending user input to the child stdin
    let writer = master
        .take_writer()
        .map_err(|e| format!("take_writer failed: {}", e))?;

    // Clone reader for output (before we move master into state)
    let reader = master
        .try_clone_reader()
        .map_err(|e| format!("clone reader failed: {}", e))?;

    // Store master (for future resize)
    {
        let mut mg = state.master.lock().unwrap();
        *mg = Some(master);
    }

    // Store writer
    {
        let mut wg = state.writer.lock().unwrap();
        *wg = Some(writer);
    }

    // Store killer
    {
        let mut kg = state.child_killer.lock().unwrap();
        *kg = Some(child.clone_killer());
    }

    {
        let mut cwd = state.current_cwd.lock().unwrap();
        *cwd = Some(repo_path.clone());
    }

    // Spawn reader thread that feeds output to the frontend
    let app_handle = app.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut r = reader;
        loop {
            match r.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let s = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit("terminal-output", s);
                }
                Err(_) => break,
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn write_to_terminal(state: State<'_, TerminalState>, data: String) -> Result<(), String> {
    let mut wg = state.writer.lock().unwrap();
    if let Some(w) = wg.as_mut() {
        w.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
        let _ = w.flush();
    }
    Ok(())
}

#[tauri::command]
pub fn resize_terminal(state: State<'_, TerminalState>, rows: u16, cols: u16) -> Result<(), String> {
    let mut mg = state.master.lock().unwrap();
    if let Some(master) = mg.as_mut() {
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        master.resize(size).map_err(|e| e.to_string())?;
    }
    Ok(())
}
