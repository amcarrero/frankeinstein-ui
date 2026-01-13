declare module 'pg' {
  export interface QueryResult {
    rows: unknown[]
  }

  export class Pool {
    constructor(config?: unknown)
    query<T = QueryResult>(text: string, params?: unknown[]): Promise<T>
    end(): Promise<void>
  }
}
