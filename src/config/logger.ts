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
    [LogLevel.test]: 'silly',
    [LogLevel.trace]: 'trace',
    [LogLevel.debug]: 'debug',
    [LogLevel.info]: 'info',
    [LogLevel.warn]: 'warn',
    [LogLevel.error]: 'error',
    [LogLevel.fatal]: 'fatal',
  } as const

  // Map our log levels to tslog levels
  private tsLogLevelNumgerMap = {
    [LogLevel.test]: 0,
    [LogLevel.trace]: 1,
    [LogLevel.debug]: 2,
    [LogLevel.info]: 3,
    [LogLevel.warn]: 4,
    [LogLevel.error]: 5,
    [LogLevel.fatal]: 6,
  } as const

  public static fromLogger(logger: AgentLogger, name?: string) {
    return new AgentLogger(logger.logLevel, name, logger.logger)
  }

  public constructor(logLevel: LogLevel, name?: string, logger?: Logger<ILogObj>) {
    super(logLevel)

    if (logger) {
      this.logger = logger.getSubLogger({
        name,
        minLevel: this.logLevel == LogLevel.off ? undefined : this.tsLogLevelNumgerMap[this.logLevel],
      })
    } else {
      this.logger = new Logger({
        name,
        minLevel: this.logLevel == LogLevel.off ? undefined : this.tsLogLevelNumgerMap[this.logLevel],
        attachedTransports: [logToTransport],
      })
    }
  }

  private log(level: Exclude<LogLevel, LogLevel.off>, message: string, data?: Record<string, any>): void {
    const tsLogLevel = this.tsLogLevelStringMap[level]

    if (this.logLevel === LogLevel.off) return

    if (data) {
      this.logger[tsLogLevel](message, JSON.parse(JSON.stringify(data, replaceError, 2)))
    } else {
      this.logger[tsLogLevel](message)
    }
  }

  public test(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.test, message, data)
  }

  public trace(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.trace, message, data)
  }

  public debug(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.debug, message, data)
  }

  public info(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.info, message, data)
  }

  public warn(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.warn, message, data)
  }

  public error(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.error, message, data)
  }

  public fatal(message: string, data?: Record<string, any>): void {
    this.log(LogLevel.fatal, message, data)
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
