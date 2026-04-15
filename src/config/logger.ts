/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ILogObj } from 'tslog'

import { appendFileSync } from 'fs'
import { Logger } from 'tslog'

import { LogLevel, BaseLogger } from '@credo-ts/core'

function logToTransport(logObject: ILogObj) {
  const obj = logObject as {
    _meta: { date: string; logLevelName: string; path: { filePathWithLine: string } }
    0: string
    1: unknown | undefined
  }
  appendFileSync(
    'logs.txt',
    `${new Date(obj._meta.date).toISOString()} ${obj._meta.logLevelName.padEnd(10)} ${obj['0']} ${JSON.stringify(
      obj['1'] ?? {},
      replaceError,
      2
    )}` + '\n'
  )
}

export class AgentLogger extends BaseLogger {
  public readonly logger: Logger<ILogObj>

  // Map our log levels to tslog levels
  private tsLogLevelStringMap = {
    [LogLevel.Test]: 'silly',
    [LogLevel.Trace]: 'trace',
    [LogLevel.Debug]: 'debug',
    [LogLevel.Info]: 'info',
    [LogLevel.Warn]: 'warn',
    [LogLevel.Error]: 'error',
    [LogLevel.Fatal]: 'fatal',
  } as const

  // Map our log levels to tslog levels
  private tsLogLevelNumgerMap = {
    [LogLevel.Test]: 0,
    [LogLevel.Trace]: 1,
    [LogLevel.Debug]: 2,
    [LogLevel.Info]: 3,
    [LogLevel.Warn]: 4,
    [LogLevel.Error]: 5,
    [LogLevel.Fatal]: 6,
  } as const

  public static fromLogger(logger: AgentLogger, name?: string) {
    return new AgentLogger(logger.logLevel, name, logger.logger)
  }

  public constructor(logLevel: LogLevel, name?: string, logger?: Logger<ILogObj>) {
    super(logLevel)

    if (logger) {
      this.logger = logger.getSubLogger({
        name,
        minLevel: this.logLevel == LogLevel.Off ? undefined : this.tsLogLevelNumgerMap[this.logLevel],
      })
    } else {
      this.logger = new Logger({
        name,
        minLevel: this.logLevel == LogLevel.Off ? undefined : this.tsLogLevelNumgerMap[this.logLevel],
        attachedTransports: [logToTransport],
      })
    }
  }

  private log(level: Exclude<LogLevel, LogLevel.Off>, message: string, data?: Record<string, any>): void {
    const tsLogLevel = this.tsLogLevelStringMap[level]

    if (this.logLevel === LogLevel.Off) return

    if (data) {
      this.logger[tsLogLevel](message, JSON.parse(JSON.stringify(data, replaceError, 2)))
    } else {
      this.logger[tsLogLevel](message)
    }
  }

  public test(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Test, message, data)
  }

  public trace(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Trace, message, data)
  }

  public debug(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Debug, message, data)
  }

  public info(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Info, message, data)
  }

  public warn(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Warn, message, data)
  }

  public error(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Error, message, data)
  }

  public fatal(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.Fatal, message, data)
  }
}

/*
 * The replacer parameter allows you to specify a function that replaces values with your own. We can use it to control what gets stringified.
 */
function replaceError(_: unknown, value: unknown) {
  if (value instanceof Error) {
    const newValue = Object.getOwnPropertyNames(value).reduce(
      (obj, propName) => {
        obj[propName] = (value as unknown as Record<string, unknown>)[propName]
        return obj
      },
      { name: value.name } as Record<string, unknown>
    )
    return newValue
  }

  return value
}
