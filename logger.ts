// deno-lint-ignore-file no-explicit-any
// import { Logtail } from "https://esm.sh/@logtail/node@0.4.0";

// temporary until Logtail works with Deno Deploy
class Logtail {
  private middleware: any[];

  constructor(
    private readonly token: string,
    private readonly options: { batchInterval: number },
  ) {
    this.middleware = [];
  }

  info = (...args: any[]) => console.log(...args);
  error = (...args: any[]) => console.error(...args);
  debug = (...args: any[]) => console.debug(...args);

  use = (fn: (payload: any) => Promise<any>) => {
    this.middleware.push(fn);
  };
}

const LOGTAIL_SOURCE_TOKEN = Deno.env.get("LOGTAIL_SOURCE_TOKEN") as string;

const instanceId = crypto.randomUUID();

export type Log = ReturnType<typeof createLog>;

export const createLog = <T>(extra?: T) => {
  const log = new Logtail(LOGTAIL_SOURCE_TOKEN, { batchInterval: 1000 });

  log.use((payload) => Promise.resolve({ ...payload, instanceId, ...extra }));

  return log;
};

export const list = <T>(array: T[]) =>
  array.reduce(
    (acc, message, index) => {
      acc[index] = message;
      return acc;
    },
    {} as Record<number, T>,
  );
