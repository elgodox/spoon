mod commands;
mod terminal;

use commands::{
    add_remote, add_safe_directory, checkout_branch, commit_changes, create_branch, create_stash, create_tag, delete_local_branch, delete_remote, delete_tag, delete_untracked_file, discard_file_changes, fetch, get_branches, get_commit_log, get_diff, get_file_changes,
    detect_cli_commands, get_project_status, get_remote_url, get_remotes, get_stashes, get_tags, is_repo_safe, run_git_command, scan_directory, set_remote_url, stage_files, stash_apply, stash_drop, stash_pop, unstage_files,
};
use terminal::{resize_terminal, start_powershell, write_to_terminal, TerminalState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .manage(TerminalState::default())
    .setup(|_app| {
      if cfg!(debug_assertions) {
        // extra dev logging if needed
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      scan_directory,
      get_branches,
      get_remotes,
      get_commit_log,
      get_file_changes,
      get_project_status,
      run_git_command,
      detect_cli_commands,
      stage_files,
      unstage_files,
      commit_changes,
      checkout_branch,
      add_remote,
      set_remote_url,
      get_remote_url,
      fetch,
      get_diff,
      get_tags,
      get_stashes,
      create_tag,
      create_stash,
      is_repo_safe,
      add_safe_directory,
      delete_local_branch,
      create_branch,
      discard_file_changes,
      delete_untracked_file,
      stash_pop,
      stash_apply,
      stash_drop,
      delete_tag,
      delete_remote,
      start_powershell,
      write_to_terminal,
      resize_terminal,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
