mod commands;

use commands::{
    checkout_branch, commit_changes, fetch, get_branches, get_commit_log, get_diff, get_file_changes,
    scan_directory, stage_files, unstage_files,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_log::Builder::default().build())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .setup(|_app| {
      if cfg!(debug_assertions) {
        // extra dev logging if needed
      }
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      scan_directory,
      get_branches,
      get_commit_log,
      get_file_changes,
      stage_files,
      unstage_files,
      commit_changes,
      checkout_branch,
      fetch,
      get_diff,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
