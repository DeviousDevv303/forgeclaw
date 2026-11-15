// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// GitHub-specific tools

import type { ToolDef } from '../forgeTools'

export const githubTools: ToolDef[] = [
  {
    name: 'github_read_file',
    description: 'Read the contents of a file from a GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        path:  { type: 'string', description: 'File path relative to repo root, e.g. src/App.tsx' },
        owner: { type: 'string', description: 'GitHub owner (defaults to configured repo owner)' },
        repo:  { type: 'string', description: 'GitHub repo name (defaults to configured repo)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'github_write_file',
    description: 'Create or update a file in a GitHub repository with a commit message.',
    parameters: {
      type: 'object',
      properties: {
        path:    { type: 'string', description: 'File path relative to repo root' },
        content: { type: 'string', description: 'Full file content to write' },
        message: { type: 'string', description: 'Commit message' },
        branch:  { type: 'string', description: 'Branch to write to' },
        owner:   { type: 'string', description: 'GitHub owner' },
        repo:    { type: 'string', description: 'GitHub repo' },
      },
      required: ['path', 'content', 'message'],
    },
  },
  {
    name: 'github_list_files',
    description: 'List files and directories at a path in a GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        path:  { type: 'string', description: 'Directory path' },
        owner: { type: 'string', description: 'GitHub owner' },
        repo:  { type: 'string', description: 'GitHub repo' },
      },
      required: [],
    },
  },
  {
    name: 'github_search_code',
    description: 'Search for code matching a query in a GitHub repository.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        owner: { type: 'string', description: 'GitHub owner' },
        repo:  { type: 'string', description: 'GitHub repo' },
      },
      required: ['query'],
    },
  },
  {
    name: 'github_create_issue',
    description: 'Create a GitHub issue in a repository.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Issue title' },
        body:  { type: 'string', description: 'Issue body (markdown supported)' },
        owner: { type: 'string', description: 'GitHub owner' },
        repo:  { type: 'string', description: 'GitHub repo' },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'github_run_workflow',
    description: 'Trigger a GitHub Actions workflow dispatch.',
    parameters: {
      type: 'object',
      properties: {
        workflow: { type: 'string', description: 'Workflow file name' },
        ref:      { type: 'string', description: 'Branch or tag' },
        owner:    { type: 'string', description: 'GitHub owner' },
        repo:     { type: 'string', description: 'GitHub repo' },
      },
      required: ['workflow'],
    },
  },
  {
    name: 'github_get_run_status',
    description: 'Get the status of a GitHub Actions workflow run.',
    parameters: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'Workflow run ID' },
        owner:  { type: 'string', description: 'GitHub owner' },
        repo:   { type: 'string', description: 'GitHub repo' },
      },
      required: ['run_id'],
    },
  },
]