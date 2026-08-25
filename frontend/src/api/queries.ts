import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  NotificationRule,
  NotificationRuleInput,
  Overview,
  RepoConditions,
  RepoSetup,
  RepoSettingsInput,
  SetupStatus,
  Task,
  TaskDetail,
  TaskFilters,
} from '../types';

const POLL_MS = 4000;

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: () => api.get<Overview>('/api/overview'),
    refetchInterval: POLL_MS,
  });
}

function taskQueryString(filters: TaskFilters): string {
  const params = new URLSearchParams();
  if (filters.states.size) params.set('state', [...filters.states].join(','));
  if (filters.repo) params.set('repo', filters.repo);
  if (filters.q) params.set('q', filters.q);
  return params.toString();
}

export function useTasks(filters: TaskFilters) {
  const qs = taskQueryString(filters);
  return useQuery({
    queryKey: ['tasks', qs],
    queryFn: () => api.get<Task[]>(`/api/tasks?${qs}`),
    refetchInterval: POLL_MS,
  });
}

export function useTask(id: number | null) {
  return useQuery({
    queryKey: ['task', id],
    queryFn: () => api.get<TaskDetail>(`/api/tasks/${id}`),
    enabled: id != null,
    refetchInterval: POLL_MS,
  });
}

export function useRunLog(runId: number | null) {
  return useQuery({
    queryKey: ['run-log', runId],
    queryFn: () => api.get<string>(`/api/runs/${runId}/log`, { silent: true }),
    enabled: runId != null,
    retry: false,
  });
}

export function useTaskAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'requeue' | 'restart' | 'skip' | 'force' }) =>
      api.post(`/api/tasks/${id}/${action}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['tasks'] });
      void client.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useDispatchAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: 'pause' | 'resume') => api.post(`/api/dispatch/${action}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useAutoUpdateAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (action: 'enable' | 'disable' | 'check') => api.post(`/api/auto-update/${action}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api.get<SetupStatus>('/api/setup/status'),
  });
}

export function useRepos(enabled: boolean) {
  return useQuery({
    queryKey: ['repos'],
    queryFn: () => api.get<RepoSetup[]>('/api/repos'),
    enabled,
  });
}

function useSetupMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['setup-status'] });
      void client.invalidateQueries({ queryKey: ['repos'] });
      void client.invalidateQueries({ queryKey: ['overview'] });
    },
  });
}

export function useSaveGithubToken() {
  return useSetupMutation((token: string) => api.post('/api/setup/github/token', { token }));
}

export function useSaveClaudeToken() {
  return useSetupMutation((token: string) => api.post('/api/setup/claude', { token }));
}

export function useAddRepo() {
  return useSetupMutation(({ repo, settings }: { repo: string; settings: RepoSettingsInput }) =>
    api.post('/api/repos', { repo, settings }),
  );
}

// Fetched on demand while the "add repository" panel is open — a valid "owner/name" is
// enough, the repository does not need to be watched yet.
export function useRepoConditions(fullName: string) {
  const [owner, name] = fullName.split('/');
  return useQuery({
    queryKey: ['repo-conditions', fullName],
    queryFn: () => api.get<RepoConditions>(`/api/repos/${owner}/${name}/conditions`, { silent: true }),
    enabled: Boolean(owner && name),
    retry: false,
  });
}

export function useRemoveRepo() {
  return useSetupMutation((fullName: string) => api.delete(`/api/repos/${fullName}`));
}

export function useBootstrapRepo() {
  return useSetupMutation(({ fullName, instructions }: { fullName: string; instructions: string }) =>
    api.post(`/api/repos/${fullName}/bootstrap`, { instructions }),
  );
}

export function useNotificationRules() {
  return useQuery({
    queryKey: ['notification-rules'],
    queryFn: () => api.get<NotificationRule[]>('/api/notifications'),
  });
}

function useNotificationRuleMutation<TVariables>(mutationFn: (variables: TVariables) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['notification-rules'] });
    },
  });
}

export function useCreateNotificationRule() {
  return useNotificationRuleMutation((input: NotificationRuleInput) => api.post('/api/notifications', input));
}

export function useUpdateNotificationRule() {
  return useNotificationRuleMutation(({ id, input }: { id: number; input: NotificationRuleInput }) =>
    api.put(`/api/notifications/${id}`, input),
  );
}

export function useDeleteNotificationRule() {
  return useNotificationRuleMutation((id: number) => api.delete(`/api/notifications/${id}`));
}
