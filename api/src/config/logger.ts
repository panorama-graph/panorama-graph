import pino, { type Logger } from "pino";

export type LoggerOptions = { level: string; pretty: boolean; env: string };

export function createLogger({ level, pretty, env }: LoggerOptions): Logger {
  return pino({
    level,
    base: { service: "panorama-graph-api", env },
    serializers: { err: pino.stdSerializers.err },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(pretty
      ? { transport: { target: "pino-pretty", options: { colorize: true, ignore: "pid,hostname", translateTime: true } } }
      : {}),
  });
}
