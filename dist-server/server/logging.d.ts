export type ServerLogFields = Readonly<Record<string, unknown>>;
export declare function logServerEvent(event: string, fields?: ServerLogFields): void;
