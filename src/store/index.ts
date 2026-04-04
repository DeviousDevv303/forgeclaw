import { create } from 'zustand'
import type { Project, User } from '../types'

interface AppState {
  user: User | null
  projects: Project[]
  activeProject: Project | null
  setUser: (user: User | null) => void
  setProjects: (projects: Project[]) => void
  setActiveProject: (project: Project | null) => void
  addProject: (project: Project) => void
  updateProject: (id: string, updates: Partial<Project>) => void
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  projects: [],
  activeProject: null,
  setUser: (user) => set({ user }),
  setProjects: (projects) => set({ projects }),
  setActiveProject: (project) => set({ activeProject: project }),
  addProject: (project) => set((state) => ({ projects: [...state.projects, project] })),
  updateProject: (id, updates) => set((state) => ({
    projects: state.projects.map((p) => p.id === id ? { ...p, ...updates } : p)
  })),
}))
