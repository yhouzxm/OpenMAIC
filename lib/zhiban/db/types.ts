export interface QueryResult<TRow extends Record<string, unknown> = Record<string, unknown>> {
  rows: TRow[];
}

export interface ZhibanQueryable {
  query<TRow extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<TRow>>;
}

export interface ZhibanDatabaseClient extends ZhibanQueryable {
  release?: () => void;
}

export interface ZhibanDatabasePool extends ZhibanQueryable {
  connect(): Promise<ZhibanDatabaseClient>;
}
