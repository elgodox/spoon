export interface TechTag {
  name: string;
  color: string;
}

export interface GitStatus {
  current_branch: string | null;
  is_dirty: boolean;
  ahead: number;
  behind: number;
  changed_files: number;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  tags: TechTag[];
  has_git: boolean;
  git_status?: GitStatus;
  last_commit?: string;
  last_commit_date?: string;
}

export interface GitBranch {
  name: string;
  is_current: boolean;
  is_remote: boolean;
}

export interface GitCommit {
  hash: string;
  short_hash: string;
  author: string;
  email: string;
  date: string;
  message: string;
  refs: string[];
}

export interface FileChange {
  path: string;
  status: string;
  staged: boolean;
}

// Kanban model (frontend state)
export type ChangeCard = {
  id: string;
  file: FileChange;
};

export type CommitGroup = {
  id: string;
  title: string; // becomes commit message
  cards: ChangeCard[];
};
