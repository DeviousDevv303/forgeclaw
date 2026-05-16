// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). AGPL-3.0 License.
// Original work. Unauthorized commercial use prohibited. https://github.com/DeviousDevv303/forgeclaw
export interface Project {
  id: string;
  name: string;
  description: string;
  prompt: string;
  status: 'idle' | 'generating' | 'deploying' | 'complete' | 'error';
  repoUrl?: string;
  createdAt: string;
}

export interface GenerationStep {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'error';
  output?: string;
}

export interface User {
  id: string;
  email: string;
  githubToken?: string;
}
