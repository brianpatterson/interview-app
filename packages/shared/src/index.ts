export interface HealthResponse {
  ok: boolean;
  db: 'up' | 'down';
  time: string;
}
